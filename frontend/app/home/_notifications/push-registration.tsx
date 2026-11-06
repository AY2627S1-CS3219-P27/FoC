"use client";

import { useEffect } from "react";
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
 * docs/adr/notification-service/001-single-owner-push-endpoints.md), which
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

        await syncSubscriptionToServer(subscription);
      } catch {
        // The profile card reports the failure and offers a retry.
      }
    }

    void claim();
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
