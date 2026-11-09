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

self.addEventListener('pushsubscriptionchange', (event) => {
  void event.waitUntil(
    (async () => {
      try {
        const keyResponse = await fetch(
          '/api/notifications/subscriptions/vapid-public-key',
          { credentials: 'same-origin' },
        );
        if (!keyResponse.ok) return;
        const { publicKey } = await keyResponse.json();

        const subscription = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });

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
