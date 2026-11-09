"use client";

import { useEffect } from "react";
import { clearRotatedEndpoint, getRotatedEndpoint } from "@/lib/push-rotation-store";
import {
  registerPushServiceWorker,
  syncSubscriptionToServer,
} from "./push-client";

/**
 * Claims this browser's live push subscription for the signed-in account as
 * soon as the home page loads.
 *
 * A PushSubscription belongs to the browser profile, so after an account
 * switch it still points at the previous user's row. Registering it under the
 * current token makes the notification-service move ownership (see
 * docs/adr/notification-service/0002-single-owner-push-endpoints.md), which
 * stops the previous user's notifications from appearing on this device
 * without waiting for the profile tab to be opened.
 *
 * The profile card owns the user-facing state; failures here stay silent and
 * are surfaced there, with a retry, if the user visits it.
 */
export function PushRegistrationSync() {
  useEffect(() => {
    let cancelled = false;

    async function claim() {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;

      try {
        const registration = await registerPushServiceWorker();
        const subscription = await registration.pushManager.getSubscription();
        if (subscription === null || cancelled) return;

        // A rotation that happened while no page was open left its old
        // endpoint in IndexedDB; handing it along lets the service deactivate
        // the stale row atomically instead of leaving it active until a failed
        // delivery. Cleared only once the service has acknowledged the sync.
        const previousEndpoint = await getRotatedEndpoint();
        if (cancelled) return;

        const sync = await syncSubscriptionToServer(
          subscription,
          previousEndpoint ?? undefined,
        );
        if (sync.ok) await clearRotatedEndpoint();
      } catch {
        // The profile card reports the failure and offers a retry, if the user
        // visits it.
      }
    }

    function onSubscriptionRotated(event: MessageEvent) {
      const data = event.data as {
        type?: string;
        subscription?: PushSubscriptionJSON;
        previousEndpoint?: string;
      };
      if (
        data?.type !== "subscription-rotated" ||
        !data.subscription ||
        cancelled
      ) {
        return;
      }

      // The browser changed its subscription out from under us (the push
      // service rotated the endpoint). Rotate the stored row so the old
      // endpoint stops receiving deliveries.
      void syncSubscriptionToServer(
        data.subscription,
        data.previousEndpoint,
      )
        .then((sync) => {
          // The worker also persisted this rotation for the next load; this
          // fast path has just consumed it.
          if (sync.ok) return clearRotatedEndpoint();
        })
        .catch(() => {
          // The card re-syncs this browser's subscription on the next load.
        });
    }

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("message", onSubscriptionRotated);
    }

    void claim();
    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener(
        "message",
        onSubscriptionRotated,
      );
    };
  }, []);

  return null;
}
