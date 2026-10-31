"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { isValidCoord, SEND_MIN_INTERVAL_MS, shouldSend, type SendState } from "@/lib/tracking";

type Phase = "off" | "starting" | "sharing" | "stopped";

interface Fix {
  lat: number;
  lng: number;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
}

function numOrNull(n: number | null | undefined): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

export function CourierLocationShare({ errandId }: { errandId: string }) {
  const [phase, setPhase] = useState<Phase>("off");
  const [notice, setNotice] = useState<{ text: string; kind: "error" | "info" } | null>(null);
  const [lastOkAt, setLastOkAt] = useState<number | null>(null);

  const watchId = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const latest = useRef<Fix | null>(null);
  const sendState = useRef<SendState>({ lastSentAt: null, lastSent: null });
  const inFlight = useRef(false);
  const active = useRef(false);

  const halt = useCallback((next: Phase, message?: { text: string; kind: "error" | "info" }) => {
    active.current = false;
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    latest.current = null;
    sendState.current = { lastSentAt: null, lastSent: null };
    setPhase(next);
    setNotice(message ?? null);
  }, []);

  const maybeSend = useCallback(async () => {
    const fix = latest.current;
    if (!active.current || !fix || inFlight.current) return;
    const now = Date.now();
    if (!shouldSend(sendState.current, fix, now)) return;
    inFlight.current = true;
    // Mark the attempt up front so a failing network is also throttled.
    sendState.current = { lastSentAt: now, lastSent: { lat: fix.lat, lng: fix.lng } };
    const res = await api("POST", `/api/errands/${errandId}/location`, {
      body: {
        lat: fix.lat,
        lng: fix.lng,
        ...(fix.accuracy !== null && { accuracy: fix.accuracy }),
        ...(fix.heading !== null && { heading: fix.heading }),
        ...(fix.speed !== null && { speed: fix.speed }),
      },
      quiet: true,
    });
    inFlight.current = false;
    if (!active.current) return;
    if (res.ok) {
      setLastOkAt(Date.now());
      setNotice(null);
    } else if (res.status === 409) {
      halt("stopped", {
        text: "Location sharing stopped because this errand is no longer Picked Up.",
        kind: "info",
      });
    } else if (res.status === 403 || res.status === 404) {
      halt("stopped", {
        text: "Location sharing stopped: you can no longer share location for this errand.",
        kind: "error",
      });
    } else if (res.status === 400) {
      setNotice({
        text: "Your location was not accepted (it looks to be outside the campus area). Still trying.",
        kind: "error",
      });
    } else {
      setNotice({ text: "Could not reach the server. Will keep trying.", kind: "error" });
    }
  }, [errandId, halt]);

  function start() {
    if (typeof window === "undefined" || !("geolocation" in navigator)) {
      setNotice({ text: "This browser does not support location sharing.", kind: "error" });
      return;
    }
    if (!window.isSecureContext) {
      setNotice({
        text: "Location needs a secure connection (HTTPS or localhost). Open the app over HTTPS to share.",
        kind: "error",
      });
      return;
    }
    active.current = true;
    setPhase("starting");
    setNotice(null);
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy, heading, speed } = pos.coords;
        if (!isValidCoord(latitude, longitude)) return;
        latest.current = {
          lat: latitude,
          lng: longitude,
          accuracy: numOrNull(accuracy),
          heading: numOrNull(heading),
          speed: numOrNull(speed),
        };
        setPhase("sharing");
        void maybeSend();
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          halt("off", {
            text: "Location permission was denied. Allow location for this site in your browser settings, then try again.",
            kind: "error",
          });
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          setNotice({ text: "Your position is currently unavailable. Waiting for a fix.", kind: "error" });
        }
        // TIMEOUT: watchPosition keeps trying on its own.
      },
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
    );
    // Heartbeat while stationary (watchPosition may stay silent); shouldSend enforces the 15 s rule.
    timer.current = setInterval(() => void maybeSend(), SEND_MIN_INTERVAL_MS);
  }

  useEffect(
    () => () => {
      active.current = false;
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
      if (timer.current) clearInterval(timer.current);
    },
    [],
  );

  const on = phase === "starting" || phase === "sharing";

  return (
    <section
      aria-labelledby={`share-${errandId}`}
      className="mt-6 rounded-xl border border-border bg-surface p-4 space-y-3"
    >
      <h4 id={`share-${errandId}`} className="text-sm font-semibold">
        Live location
      </h4>

      <label className="flex items-start gap-3 text-sm cursor-pointer">
        <input
          type="checkbox"
          role="switch"
          checked={on}
          onChange={(e) => (e.target.checked ? start() : halt("off"))}
          className="mt-0.5 h-4 w-4 accent-nus-orange"
          aria-describedby={`share-help-${errandId}`}
        />
        <span>Share my live location with the requester</span>
      </label>

      <p id={`share-help-${errandId}`} className="text-xs text-muted">
        Optional and off by default. While on, your location is shared with the requester of this
        errand until delivery, and is not stored. Tracking only works while this tab stays open;
        keep it open and your screen awake. You can still deliver without sharing.
      </p>

      {on && (
        <p role="status" className="text-sm font-medium text-success">
          {phase === "starting"
            ? "Waiting for your location…"
            : `Sharing your location${lastOkAt ? ` · last sent ${new Date(lastOkAt).toLocaleTimeString()}` : ""}`}
        </p>
      )}
      {on && (
        <button
          onClick={() => halt("off")}
          className="btn-press rounded-xl border border-danger px-3.5 py-2 text-sm font-semibold text-danger hover:bg-danger/10"
        >
          Stop sharing
        </button>
      )}
      {!on && phase === "stopped" && !notice && (
        <p role="status" className="text-sm text-muted">
          Location sharing stopped.
        </p>
      )}
      {notice && (
        <p
          role={notice.kind === "error" ? "alert" : "status"}
          className={`text-sm ${notice.kind === "error" ? "text-danger" : "text-muted"}`}
        >
          {notice.text}
        </p>
      )}
    </section>
  );
}
