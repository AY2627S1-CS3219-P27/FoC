'use client';

import { api } from '@/lib/api';
import {
  getPendingRotations,
  removePendingRotation,
} from '@/lib/push-rotation-store';

const SERVICE_WORKER_URL = '/service-worker.js';

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
    scope: '/',
    updateViaCache: 'none',
  });
}

// Only one subscription sync runs at a time: the page-load claim, the service
// worker's rotation message and the profile card all funnel through this queue.
// Concurrent POSTs could resurrect a stale endpoint — a slower sync carrying a
// subscription the browser no longer holds would land after a fresher rotation
// and conflict-reactivate it.
let syncQueue: Promise<unknown> = Promise.resolve();

function enqueueSync<T>(task: () => Promise<T>): Promise<T> {
  const run = syncQueue.then(task, task);
  syncQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Re-reads the browser's live subscription inside the queue and syncs it.
 * Callers must not pass a subscription captured earlier: a rotation that
 * happened while this call waited in the queue would otherwise be overwritten
 * with an endpoint the browser no longer holds. Resolves with null when this
 * browser holds no subscription (or cannot).
 */
export async function syncCurrentSubscription(): Promise<SyncResult | null> {
  return enqueueSync(async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      return null;
    }

    const registration = await registerPushServiceWorker();
    const subscription = await registration.pushManager.getSubscription();
    if (subscription === null) return null;

    return postSubscription(subscription);
  });
}

/**
 * Tells the notification-service about a live PushSubscription the browser
 * holds.
 *
 * A changed endpoint is a *new* subscription by design (the endpoint is the
 * push service's identity for the destination), so POST creates the row. The
 * stale endpoints this browser rotated away from — the ones persisted in
 * IndexedDB while no page was open, plus any explicit hint — are handed along
 * so the service can deactivate their rows in the same transaction as the
 * insert, instead of leaving them active. A 409 means this user already
 * registered the endpoint — for example after a soft delete, or when the
 * browser re-issued the same endpoint with fresh keys — so the row is
 * reconciled with PATCH instead; the stale endpoints are then deactivated with
 * idempotent DELETEs, which a PATCH alone could not carry.
 *
 * A different signed-in account on the same browser is handled server-side:
 * the POST takes the endpoint over and deactivates the previous owner's row.
 */
export async function syncSubscriptionToServer(
  subscription: PushSubscription | PushSubscriptionJSON,
  previousEndpoint?: string,
): Promise<SyncResult> {
  return enqueueSync(() => postSubscription(subscription, previousEndpoint));
}

async function postSubscription(
  subscription: PushSubscription | PushSubscriptionJSON,
  previousEndpoint?: string,
): Promise<SyncResult> {
  // The service worker can only hand the JSON shape across postMessage
  // (PushSubscription is not structured-cloneable); the profile card passes the
  // live browser object. Normalise both before talking to the service.
  const payload =
    'toJSON' in subscription ? subscription.toJSON() : subscription;
  // The JSON shape types endpoint as optional; a message without one cannot
  // identify a row, so fail visibly instead of POSTing a broken payload.
  if (!payload.endpoint) {
    return {
      ok: false,
      message: "This browser's push subscription is missing its endpoint.",
    };
  }
  const endpoint = payload.endpoint;

  // Read after any earlier sync in the queue finished, so a rotation that
  // completed while this sync waited is neither lost nor double-counted.
  const stored = await getPendingRotations();
  const previousEndpoints = [
    ...new Set([previousEndpoint, ...stored]),
  ].filter(
    (candidate): candidate is string =>
      candidate !== undefined && candidate !== endpoint,
  );

  const body: Record<string, unknown> = { ...payload };
  if (previousEndpoints.length > 0) {
    body.previousEndpoints = previousEndpoints;
  }

  let result = await api('POST', '/api/notifications/subscriptions/web', {
    body,
  });

  if (result.status === 409) {
    const patchBody: Record<string, unknown> = {
      status: 'active',
      expirationTime: payload.expirationTime ?? null,
    };
    if (payload.keys?.p256dh && payload.keys.auth) {
      patchBody.keys = {
        p256dh: payload.keys.p256dh,
        auth: payload.keys.auth,
      };
    }

    result = await api(
      'PATCH',
      `/api/notifications/subscriptions/web?endpoint=${encodeURIComponent(
        endpoint,
      )}`,
      { body: patchBody },
    );

    // PATCH cannot carry the stale endpoints, so retire them directly; DELETE
    // is owner-scoped and idempotent.
    if (result.ok) {
      await Promise.all(
        previousEndpoints.map((candidate) =>
          api(
            'DELETE',
            `/api/notifications/subscriptions/web?endpoint=${encodeURIComponent(
              candidate,
            )}`,
          ),
        ),
      );
    }
  }

  // Cleared only once the service acknowledged the sync; a failed one keeps
  // the records for the next load or the next queued sync.
  if (result.ok) {
    await Promise.all(previousEndpoints.map(removePendingRotation));
  }

  return { ok: result.ok, message: result.message };
}
