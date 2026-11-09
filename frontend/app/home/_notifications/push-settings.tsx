"use client";

import { useCallback, useEffect, useState } from "react";
import { api, authFetch } from "@/lib/api";
import {
  syncCurrentSubscription,
  syncSubscriptionToServer,
} from "./push-client";

type PushStatus =
  | "checking"
  | "unsupported"
  | "idle"
  | "syncing"
  | "subscribed"
  | "denied"
  | "error";

// A browser's PushSubscription wants the VAPID key as raw bytes.
function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    output[i] = rawData.charCodeAt(i);
  }
  return output;
}

/**
 * Profile-tab card that opts this browser/device into Web Push.
 *
 * The service worker is registered here; the subscription itself lives in the
 * notification-service, keyed by the signed-in user. Multiple devices simply
 * produce multiple rows for the same user.
 *
 * The browser holding a subscription is not proof the server still has it: the
 * row can be soft-deleted, lost with a database reset, or held by whoever was
 * signed in on this browser before. The card only says "Enabled" after the
 * server acknowledges the subscription, and offers a retry when it does not.
 */
export function PushNotificationsCard() {
  const [status, setStatus] = useState<PushStatus>("checking");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function detect() {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        if (!cancelled) setStatus("unsupported");
        return;
      }

      try {
        // The browser may have rotated the endpoint while the user was away
        // (pushsubscriptionchange), or this device may still hold a previous
        // account's subscription. Claim it before claiming it works: the sync
        // re-reads the live subscription inside the sync queue, so it never
        // posts one captured before a rotation.
        if (!cancelled) setStatus("syncing");
        const sync = await syncCurrentSubscription();
        if (cancelled) return;

        if (sync === null) {
          if (!cancelled) setStatus("idle");
          return;
        }

        if (sync.ok) {
          setStatus("subscribed");
        } else {
          setStatus("error");
          setMessage(
            sync.message ??
              "Could not confirm this device with the notification service.",
          );
        }
      } catch {
        // Registration can be retried when the user clicks Enable.
        if (!cancelled) setStatus("idle");
      }
    }

    void detect();
    return () => {
      cancelled = true;
    };
  }, []);

  const subscribe = useCallback(async () => {
    setBusy(true);
    setMessage("");

    try {
      if (
        typeof Notification !== "undefined" &&
        Notification.permission === "denied"
      ) {
        setStatus("denied");
        return;
      }

      const registration = await navigator.serviceWorker.ready;

      // A retry reuses the subscription the browser already holds; only an
      // unsubscribed browser needs the VAPID key and a new subscription.
      let subscription = await registration.pushManager.getSubscription();
      const created = subscription === null;

      if (subscription === null) {
        const keyResponse = await authFetch(
          "/api/notifications/subscriptions/vapid-public-key",
        );
        if (!keyResponse.ok) {
          setMessage("Could not load the push configuration. Try again later.");
          return;
        }
        const { publicKey } = (await keyResponse.json()) as { publicKey: string };

        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
      }

      const sync = await syncSubscriptionToServer(subscription);
      if (!sync.ok) {
        if (created) {
          // Keep this browser and the server in sync: drop the local
          // subscription if the service could not store it.
          await subscription.unsubscribe();
          setStatus("idle");
        } else {
          // Keep the existing subscription so the user can retry or disable it.
          setStatus("error");
        }
        setMessage(
          sync.message ??
            "Could not register this device for push notifications.",
        );
        return;
      }

      setStatus("subscribed");
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotAllowedError") {
        setStatus("denied");
      } else {
        setMessage("Could not enable push notifications on this device.");
      }
    } finally {
      setBusy(false);
    }
  }, []);

  const unsubscribe = useCallback(async () => {
    setBusy(true);
    setMessage("");

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        const result = await api(
          "DELETE",
          `/api/notifications/subscriptions/web?endpoint=${encodeURIComponent(
            subscription.endpoint,
          )}`,
        );

        if (!result.ok) {
          setMessage(result.message ?? "Could not update your push settings.");
          return;
        }

        await subscription.unsubscribe();
      }

      setStatus("idle");
    } catch {
      setMessage("Could not update your push settings.");
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <section className="rounded-2xl border border-border bg-surface p-6 mb-6 shadow-sm">
      <h3 className="text-lg font-semibold mb-2">Push notifications</h3>
      <p className="text-sm text-muted mb-4">
        Get a browser notification when something happens on FoC. This setting
        applies to this device only — enable it on each device you use.
      </p>

      {status === "checking" && (
        <p role="status" className="text-sm text-muted">
          Checking this browser…
        </p>
      )}

      {status === "syncing" && (
        <p role="status" className="text-sm text-muted">
          Confirming this device…
        </p>
      )}

      {status === "unsupported" && (
        <p className="text-sm text-muted">
          This browser does not support push notifications. On iPhone or iPad,
          add FoC to your Home Screen first.
        </p>
      )}

      {status === "denied" && (
        <p className="text-sm text-nus-orange">
          Notifications are blocked for this site. Allow them in your browser
          settings, then try again.
        </p>
      )}

      {(status === "idle" || status === "subscribed" || status === "error") && (
        <div className="flex items-center gap-3">
          {status === "idle" && (
            <button
              onClick={subscribe}
              disabled={busy}
              className="btn-press rounded-xl bg-nus-orange px-4 py-2 text-sm font-semibold text-white hover:bg-nus-orange-hover transition-colors disabled:opacity-60"
            >
              {busy ? "Enabling…" : "Enable on this device"}
            </button>
          )}

          {status === "subscribed" && (
            <>
              <span className="text-sm text-success">
                Enabled on this device
              </span>
              <button
                onClick={unsubscribe}
                disabled={busy}
                className="btn-press rounded-xl border border-border px-4 py-2 text-sm hover:bg-background transition-colors disabled:opacity-60"
              >
                {busy ? "Disabling…" : "Disable"}
              </button>
            </>
          )}

          {status === "error" && (
            <>
              <button
                onClick={subscribe}
                disabled={busy}
                className="btn-press rounded-xl bg-nus-orange px-4 py-2 text-sm font-semibold text-white hover:bg-nus-orange-hover transition-colors disabled:opacity-60"
              >
                {busy ? "Retrying…" : "Retry"}
              </button>
              <button
                onClick={unsubscribe}
                disabled={busy}
                className="btn-press rounded-xl border border-border px-4 py-2 text-sm hover:bg-background transition-colors disabled:opacity-60"
              >
                {busy ? "Disabling…" : "Disable"}
              </button>
            </>
          )}
        </div>
      )}

      {message && (
        <p className="text-sm text-nus-orange mt-2 fade-in">{message}</p>
      )}
    </section>
  );
}
