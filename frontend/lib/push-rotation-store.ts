// Durable record of the push endpoints the push service replaced while no page
// was open.
//
// The service worker can only tell a rotation to page clients that are open
// (clients.matchAll()); a browser that is closed at rotation time would
// otherwise lose the old endpoints, leaving their rows active on the server
// until a delivery attempt answers 404/410. The worker persists each endpoint
// here and the next page load hands them to the notification-service, which
// rotates them atomically
// (docs/adr/notification-service/0002-single-owner-push-endpoints.md).
//
// Records are keyed by the endpoint itself, so repeated rotations accumulate
// instead of clobbering each other, and the worker writing one endpoint cannot
// clobber the page clearing another. The v1 layout kept a single overwritten
// record under the literal key "pending"; that record is still readable (every
// record carries its endpoint) and is cleared alongside the endpoint it
// describes.
//
// IndexedDB is origin-scoped, so the worker and the page share this store.
// Every operation degrades to a no-op when storage is unavailable (for example
// private browsing), matching the previous behaviour.

const DB_NAME = "foc-push-rotation";
const STORE = "rotations";
const LEGACY_KEY = "pending";

/**
 * The record id is the endpoint itself; the v1 layout used the literal key
 * "pending" for a single overwritten record.
 */
interface RotationRecord {
  id: string;
  endpoint: string;
  savedAt: number;
}

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

export async function addPendingRotation(endpoint: string): Promise<void> {
  const db = await openDatabase().catch(() => null);
  if (db === null) return;
  try {
    await run(db, "readwrite", (store) =>
      store.put({
        id: endpoint,
        endpoint,
        savedAt: Date.now(),
      } satisfies RotationRecord),
    );
  } catch {
    // Losing this only delays the rotation to the delivery-time 404/410 path.
  } finally {
    db.close();
  }
}

export async function getPendingRotations(): Promise<string[]> {
  const db = await openDatabase().catch(() => null);
  if (db === null) return [];
  try {
    const records = await run<RotationRecord[]>(db, "readonly", (store) =>
      store.getAll() as IDBRequest<RotationRecord[]>,
    );
    return [
      ...new Set(
        records
          .filter((record) => typeof record?.endpoint === "string")
          .sort((a, b) => a.savedAt - b.savedAt)
          .map((record) => record.endpoint),
      ),
    ];
  } catch {
    return [];
  } finally {
    db.close();
  }
}

export async function removePendingRotation(endpoint: string): Promise<void> {
  const db = await openDatabase().catch(() => null);
  if (db === null) return;
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      // The legacy "pending" record describes exactly one endpoint; clear it
      // only when that endpoint is the one being acknowledged.
      const legacy = store.get(LEGACY_KEY);
      legacy.onsuccess = () => {
        const record = legacy.result as RotationRecord | undefined;
        if (record?.endpoint === endpoint) store.delete(LEGACY_KEY);
        store.delete(endpoint);
      };
      legacy.onerror = () => reject(legacy.error);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } catch {
    // Replaying the rotation is harmless: the server treats it idempotently.
  } finally {
    db.close();
  }
}
