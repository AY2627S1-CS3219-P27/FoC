"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import {
  backoffMs,
  POLL_FALLBACK_MS,
  SSE_MAX_FAILURES,
  type TrackPosition,
  type TrackRoute,
  type TrackSnapshot,
} from "@/lib/tracking";

export interface TrackingState {
  connection: "connecting" | "live" | "polling" | "ended";
  tracking: boolean;
  position: TrackPosition | null;
  route: TrackRoute | null;
  destination: { lat: number; lng: number } | null;
  endedReason: string | null;
  serverOffsetMs: number;
}

const INITIAL: TrackingState = {
  connection: "connecting",
  tracking: false,
  position: null,
  route: null,
  destination: null,
  endedReason: null,
  serverOffsetMs: 0,
};

function parse<T>(data: string): T | null {
  try {
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

/**
 * Subscribes to the errand's tracking stream (SSE, same-origin cookie auth). Reconnects with backoff
 * and falls back to polling the snapshot endpoint. Coordinates are never logged.
 */
export function useTracking(errandId: string, enabled: boolean): TrackingState {
  const [state, setState] = useState<TrackingState>(INITIAL);
  const endedRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    endedRef.current = false;
    let closed = false;
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let failures = 0;

    const base = `/api/errands/${errandId}/tracking`;

    const applySnapshot = (s: TrackSnapshot) => {
      const serverMs = typeof s.serverTime === "number" ? s.serverTime : new Date(s.serverTime).getTime();
      setState((prev) => ({
        ...prev,
        tracking: s.tracking,
        position: s.position,
        route: s.route,
        destination: s.destination,
        serverOffsetMs: Number.isNaN(serverMs) ? prev.serverOffsetMs : serverMs - Date.now(),
      }));
    };

    const end = (reason: string) => {
      endedRef.current = true;
      source?.close();
      clearInterval(pollTimer);
      clearTimeout(retryTimer);
      setState((prev) => ({ ...prev, connection: "ended", endedReason: reason }));
    };

    const pollOnce = async () => {
      const res = await api<TrackSnapshot>("GET", `${base}/snapshot`, { quiet: true });
      if (closed || endedRef.current) return;
      if (res.ok && res.data) {
        applySnapshot(res.data);
        if (res.data.status !== "Picked Up") end("status");
      } else if (res.status === 403 || res.status === 404 || res.status === 409) {
        end("unavailable");
      }
    };

    const startPolling = () => {
      if (pollTimer) return;
      setState((prev) => ({ ...prev, connection: "polling" }));
      void pollOnce();
      pollTimer = setInterval(() => void pollOnce(), POLL_FALLBACK_MS);
    };

    const connect = () => {
      if (closed || endedRef.current) return;
      if (typeof EventSource === "undefined") {
        startPolling();
        return;
      }
      const es = new EventSource(base, { withCredentials: true });
      source = es;
      es.onopen = () => {
        failures = 0;
        setState((prev) => ({ ...prev, connection: "live" }));
      };
      es.addEventListener("snapshot", (e) => {
        const s = parse<TrackSnapshot>((e as MessageEvent).data);
        if (s) applySnapshot(s);
      });
      es.addEventListener("location", (e) => {
        const p = parse<TrackPosition>((e as MessageEvent).data);
        if (p) setState((prev) => ({ ...prev, tracking: true, position: p }));
      });
      es.addEventListener("route", (e) => {
        const r = parse<TrackRoute>((e as MessageEvent).data);
        if (r) setState((prev) => ({ ...prev, route: r }));
      });
      es.addEventListener("ended", (e) => {
        const d = parse<{ reason?: string }>((e as MessageEvent).data);
        end(d?.reason ?? "ended");
      });
      es.onerror = () => {
        es.close();
        if (closed || endedRef.current) return;
        failures += 1;
        if (failures >= SSE_MAX_FAILURES) {
          startPolling();
          return;
        }
        retryTimer = setTimeout(connect, backoffMs(failures - 1, Math.random()));
      };
    };

    // First paint from the plain snapshot, then the stream.
    void pollOnce();
    connect();

    return () => {
      closed = true;
      source?.close();
      clearTimeout(retryTimer);
      clearInterval(pollTimer);
    };
  }, [errandId, enabled]);

  return enabled ? state : INITIAL;
}
