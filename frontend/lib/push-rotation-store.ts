// Durable record of a push endpoint the push service replaced while no page
// was open.
//
// The service worker can only tell a rotation to page clients that are open
// (clients.matchAll()); a browser that is closed at rotation time would
// otherwise lose the old endpoint, leaving its row active on the server until
// a delivery attempt answers 404/410. The worker persists the endpoint here and
// the next page load hands it to the notification-service, which rotates the
// row atomically (docs/adr/notification-service/0002-single-owner-push-endpoints.md).
//
// IndexedDB is origin-scoped, so the worker and the page share this store.
// Every operation degrades to a no-op when storage is unavailable (for example
// private browsing), matching the previous behaviour.

const DB_NAME = "foc-push-rotation";
const STORE = "rotations";
const KEY = "pending";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in globalThis)) {
      reject(new Error("IndexedDB is unavailable."));
      return;
    }

    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function run<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = action(transaction.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

interface RotationRecord {
  id: string;
  endpoint: string;
  savedAt: number;
}

export async function saveRotatedEndpoint(endpoint: string): Promise<void> {
  const db = await openDatabase().catch(() => null);
  if (db === null) return;
  try {
    await run(db, "readwrite", (store) =>
      store.put({ id: KEY, endpoint, savedAt: Date.now() } satisfies RotationRecord),
    );
  } catch {
    // Losing this only delays the rotation to the delivery-time 404/410 path.
  } finally {
    db.close();
  }
}

export async function getRotatedEndpoint(): Promise<string | null> {
  const db = await openDatabase().catch(() => null);
  if (db === null) return null;
  try {
    const record = await run<RotationRecord | undefined>(db, "readonly", (store) =>
      store.get(KEY),
    );
    return record?.endpoint ?? null;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

export async function clearRotatedEndpoint(): Promise<void> {
  const db = await openDatabase().catch(() => null);
  if (db === null) return;
  try {
    await run(db, "readwrite", (store) => store.delete(KEY));
  } catch {
    // Replaying the rotation is harmless: the server treats it idempotently.
  } finally {
    db.close();
  }
}
