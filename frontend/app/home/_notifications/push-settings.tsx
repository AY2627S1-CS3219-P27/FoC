"use client";

import { useCallback, useEffect, useState } from "react";
import { api, authFetch } from "@/lib/api";

type PushStatus = "checking" | "unsupported" | "idle" | "subscribed" | "denied";

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

const SERVICE_WORKER_URL = "/service-worker.js";

interface SyncResult {
  ok: boolean;
  message: string | null;
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
 */
async function syncSubscriptionToServer(
  subscription: PushSubscription,
): Promise<SyncResult> {
  const payload = subscription.toJSON();

  let result = await api("POST", "/api/notifications/subscriptions/web", {
    body: payload,
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

/**
 * Profile-tab card that opts this browser/device into Web Push.
 *
 * The service worker is registered here; the subscription itself lives in the
 * notification-service, keyed by the signed-in user. Multiple devices simply
 * produce multiple rows for the same user.
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
        const registration = await navigator.serviceWorker.register(
          SERVICE_WORKER_URL,
          { scope: "/", updateViaCache: "none" },
        );
        const subscription = await registration.pushManager.getSubscription();
        if (!cancelled) setStatus(subscription ? "subscribed" : "idle");

        if (subscription) {
          // Best-effort convergence: the browser may have rotated the endpoint
          // while the user was away (pushsubscriptionchange), which leaves the
          // server holding a stale row. Failures stay silent — the Enable and
          // Disable buttons remain the user-facing controls.
          void syncSubscriptionToServer(subscription).catch(() => {});
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
      if (typeof Notification !== "undefined" && Notification.permission === "denied") {
        setStatus("denied");
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const keyResponse = await authFetch(
        "/api/notifications/subscriptions/vapid-public-key",
      );
      if (!keyResponse.ok) {
        setMessage("Could not load the push configuration. Try again later.");
        return;
      }
      const { publicKey } = (await keyResponse.json()) as { publicKey: string };

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      const sync = await syncSubscriptionToServer(subscription);
      if (!sync.ok) {
        // Keep this browser and the server in sync: drop the local
        // subscription if the service could not store it.
        await subscription.unsubscribe();
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
          { quiet: true },
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

      {(status === "idle" || status === "subscribed") && (
        <div className="flex items-center gap-3">
          {status === "idle" ? (
            <button
              onClick={subscribe}
              disabled={busy}
              className="btn-press rounded-xl bg-nus-orange px-4 py-2 text-sm font-semibold text-white hover:bg-nus-orange-hover transition-colors disabled:opacity-60"
            >
              {busy ? "Enabling…" : "Enable on this device"}
            </button>
          ) : (
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
        </div>
      )}

      {message && (
        <p className="text-sm text-nus-orange mt-2 fade-in">{message}</p>
      )}
    </section>
  );
}
