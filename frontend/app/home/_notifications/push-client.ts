"use client";

import { api } from "@/lib/api";

const SERVICE_WORKER_URL = "/service-worker.js";

export interface SyncResult {
  ok: boolean;
  message: string | null;
}

/**
 * Registers the Web Push service worker (idempotent for a browser) and
 * resolves with its registration.
 */
export function registerPushServiceWorker() {
  return navigator.serviceWorker.register(SERVICE_WORKER_URL, {
    scope: "/",
    updateViaCache: "none",
  });
}

/**
 * Tells the notification-service about a live PushSubscription the browser
 * holds.
 *
 * A changed endpoint is a *new* subscription by design (the endpoint is the
 * push service's identity for the destination), so POST creates the row. A
 * 409 means this user already registered the endpoint — for example after a
 * soft delete, or when the browser re-issued the same endpoint with fresh
 * keys — so the row is reconciled with PATCH instead.
 *
 * A different signed-in account on the same browser is handled server-side:
 * the POST takes the endpoint over and deactivates the previous owner's row.
 */
export async function syncSubscriptionToServer(
  subscription: PushSubscription,
): Promise<SyncResult> {
  const payload = subscription.toJSON();

  let result = await api("POST", "/api/notifications/subscriptions/web", {
    body: payload,
  });

  if (result.status === 409) {
    const patchBody: Record<string, unknown> = {
      status: "active",
      expirationTime: payload.expirationTime ?? null,
    };
    if (payload.keys?.p256dh && payload.keys.auth) {
      patchBody.keys = {
        p256dh: payload.keys.p256dh,
        auth: payload.keys.auth,
      };
    }

    result = await api(
      "PATCH",
      `/api/notifications/subscriptions/web?endpoint=${encodeURIComponent(
        subscription.endpoint,
      )}`,
      { body: patchBody },
    );
  }

  return { ok: result.ok, message: result.message };
}
