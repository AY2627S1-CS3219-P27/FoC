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
 * previous endpoint is handed along with it so the service can rotate
 * ownership — deactivate the old row and insert the new one in one transaction
 * — instead of leaving both active. A 409 means this user already registered
 * the endpoint — for example after a soft delete, or when the browser re-issued
 * the same endpoint with fresh keys — so the row is reconciled with PATCH
 * instead.
 *
 * A different signed-in account on the same browser is handled server-side:
 * the POST takes the endpoint over and deactivates the previous owner's row.
 */
export async function syncSubscriptionToServer(
  subscription: PushSubscription,
  previousEndpoint?: string,
): Promise<SyncResult> {
  const payload = subscription.toJSON();
  const body: Record<string, unknown> = { ...payload };
  // Only rotation carries the old endpoint; a re-registration is a 409, not a
  // rotation, and the client reconciles it with PATCH.
  if (
    previousEndpoint !== undefined &&
    previousEndpoint !== payload.endpoint
  ) {
    body.previousEndpoint = previousEndpoint;
  }

  let result = await api("POST", "/api/notifications/subscriptions/web", {
    body,
    quiet: true,
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
      { body: patchBody, quiet: true },
    );
  }

  return { ok: result.ok, message: result.message };
}
