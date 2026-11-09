"use client";

import { useEffect } from "react";
import {
  syncCurrentSubscription,
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
 * Endpoints the push service rotated away while no page was open are read from
 * IndexedDB inside the sync, so this claim also finishes those rotations.
 *
 * The profile card owns the user-facing state; failures here stay silent and
 * are surfaced there, with a retry, if the user visits it.
 */
export function PushRegistrationSync() {
  useEffect(() => {
    let cancelled = false;

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
      // endpoint stops receiving deliveries. The worker also persisted this
      // rotation for the next load; a successful sync has just consumed it.
      void syncSubscriptionToServer(
        data.subscription,
        data.previousEndpoint,
      ).catch(() => {
        // The card re-syncs this browser's subscription on the next load.
      });
    }

    // The listener registration and removal share one availability check:
    // cleanup must not dereference navigator.serviceWorker on browsers
    // without support.
    const serviceWorkerAvailable = "serviceWorker" in navigator;
    if (serviceWorkerAvailable) {
      navigator.serviceWorker.addEventListener("message", onSubscriptionRotated);
    }

    void syncCurrentSubscription().catch(() => {
      // The profile card reports the failure and offers a retry, if the user
      // visits it.
    });

    return () => {
      cancelled = true;
      if (serviceWorkerAvailable) {
        navigator.serviceWorker.removeEventListener(
          "message",
          onSubscriptionRotated,
        );
      }
    };
  }, []);

  return null;
}
