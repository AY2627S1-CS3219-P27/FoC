// Web Push service worker for Friend on Campus.
//
// Served as a static file from public/ so it runs without the Next.js build.
// The notification-service owns subscriptions; this worker only displays
// pushes and focuses the app when one is clicked. Registered by
// app/home/_notifications/push-settings.tsx.

const DEFAULT_TITLE = "Friend on Campus";
const DEFAULT_BODY = "You have a new notification.";
const DEFAULT_ICON = "/icon.svg";

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : undefined };
  }

  const notification = {
    body: typeof payload.body === "string" ? payload.body : DEFAULT_BODY,
    icon: typeof payload.icon === "string" ? payload.icon : DEFAULT_ICON,
    badge: DEFAULT_ICON,
    tag: typeof payload.tag === "string" ? payload.tag : undefined,
    data: { url: typeof payload.url === "string" ? payload.url : "/home" },
  };

  event.waitUntil(
    self.registration.showNotification(
      typeof payload.title === "string" ? payload.title : DEFAULT_TITLE,
      notification,
    ),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = new URL(
    event.notification.data && event.notification.data.url
      ? event.notification.data.url
      : "/home",
    self.location.origin,
  ).href;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      for (const client of windows) {
        if (client.url === targetUrl && "focus" in client) {
          return client.focus();
        }
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })(),
  );
});
