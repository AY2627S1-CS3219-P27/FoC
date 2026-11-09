// Web Push service worker for Friend on Campus.
//
// Served as a static file from public/ so it runs without the Next.js build.
// The notification-service owns subscriptions; this worker only displays
// pushes and focuses the app when one is clicked. Registered by
// app/home/_notifications/push-settings.tsx.

const DEFAULT_TITLE = 'Friend on Campus';
const DEFAULT_BODY = 'You have a new notification.';
const DEFAULT_ICON = '/icon.svg';

// The push service re-issues the endpoint (VAPID key change, or the previous
// subscription answered 404/410). We re-subscribe here and hand the new one to
// the app so it can rotate the stored endpoint — the service worker itself can
// not refresh an expired access token.
//
// Only open page clients can receive that message, and the push service usually
// refreshes a subscription while the browser is closed. So the old endpoint is
// also written to IndexedDB (the origin-scoped store the app reads on load);
// the next page load finishes the rotation.
const ROTATION_DB = 'foc-push-rotation';
const ROTATION_STORE = 'rotations';
const ROTATION_KEY = 'pending';

function saveRotatedEndpoint(endpoint) {
  return new Promise((resolve) => {
    try {
      if (!self.indexedDB) {
        resolve();
        return;
      }

      const request = indexedDB.open(ROTATION_DB, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(ROTATION_STORE, { keyPath: 'id' });
      };
      request.onerror = () => resolve();
      request.onsuccess = () => {
        const db = request.result;
        try {
          const transaction = db.transaction(ROTATION_STORE, 'readwrite');
          transaction
            .objectStore(ROTATION_STORE)
            .put({ id: ROTATION_KEY, endpoint, savedAt: Date.now() });
          transaction.oncomplete = () => {
            db.close();
            resolve();
          };
          transaction.onerror = () => {
            db.close();
            resolve();
          };
        } catch {
          db.close();
          resolve();
        }
      };
    } catch {
      resolve();
    }
  });
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = globalThis.atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    output[i] = rawData.charCodeAt(i);
  }
  return output;
}

// Comparing the server's VAPID public key with the one a subscription was
// created under. Both sides are raw uncompressed P-256 points.
function sameKeyBytes(subscriptionKey, serverKey) {
  if (!subscriptionKey) return false;
  const a = new Uint8Array(subscriptionKey);
  if (a.length !== serverKey.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== serverKey[i]) return false;
  }
  return true;
}

self.addEventListener('pushsubscriptionchange', (event) => {
  void event.waitUntil(
    (async () => {
      // Persist before re-subscribing: if subscribe() fails (for example the
      // permission was revoked) or no page is open, the next load still knows
      // which endpoint it has to rotate away from.
      if (event.oldSubscription?.endpoint) {
        await saveRotatedEndpoint(event.oldSubscription.endpoint);
      }

      try {
        // Prefer the replacement the user agent already created. Subscribing
        // again would either return it (a wasted call) or — when the server's
        // VAPID key has rotated since it was made — reject with
        // InvalidStateError and lose the rotation.
        let subscription = event.newSubscription ?? null;

        const keyResponse = await fetch(
          '/api/notifications/subscriptions/vapid-public-key',
          { credentials: 'same-origin' },
        );
        const serverKey = keyResponse.ok
          ? urlBase64ToUint8Array((await keyResponse.json()).publicKey)
          : null;

        // The user agent creates its replacement with the options the old
        // subscription was made under, so after a server-side key rotation it
        // is bound to the retired key and the push service rejects our sends.
        // Re-subscribe under the current key when that is the case.
        const keyMatches =
          subscription !== null &&
          serverKey !== null &&
          sameKeyBytes(subscription.options.applicationServerKey, serverKey);

        if (subscription === null) {
          // The user agent made no replacement (expired or revoked): only a
          // fresh subscribe can produce one, and that needs the server key.
          if (serverKey === null) return;
          subscription = await self.registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: serverKey,
          });
        } else if (!keyMatches && serverKey !== null) {
          // The replacement is bound to a retired key; a live subscription
          // made under another key makes subscribe() reject, so release it
          // first.
          await subscription.unsubscribe();
          subscription = await self.registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: serverKey,
          });
        }
        // If the key fetch failed we keep the user agent's replacement as-is:
        // the endpoint still changed, which the server needs to know.

        const clients = await self.clients.matchAll();
        for (const client of clients) {
          client.postMessage({
            type: 'subscription-rotated',
            subscription: subscription.toJSON(),
            previousEndpoint: event.oldSubscription?.endpoint,
          });
        }
      } catch {
        // The next time the app opens it re-syncs the current subscription.
      }
    })(),
  );
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : undefined };
  }

  const notification = {
    body: typeof payload.body === 'string' ? payload.body : DEFAULT_BODY,
    icon: typeof payload.icon === 'string' ? payload.icon : DEFAULT_ICON,
    badge: DEFAULT_ICON,
    tag: typeof payload.tag === 'string' ? payload.tag : undefined,
    data: { url: typeof payload.url === 'string' ? payload.url : '/home' },
  };

  event.waitUntil(
    self.registration.showNotification(
      typeof payload.title === 'string' ? payload.title : DEFAULT_TITLE,
      notification,
    ),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = new URL(
    event.notification.data && event.notification.data.url
      ? event.notification.data.url
      : '/home',
    self.location.origin,
  ).href;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      for (const client of windows) {
        if (client.url === targetUrl && 'focus' in client) {
          return client.focus();
        }
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })(),
  );
});
