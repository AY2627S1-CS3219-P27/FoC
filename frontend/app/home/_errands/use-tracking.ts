"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import {
  backoffMs,
  isNewerOrEqual,
  isRouteNewerOrEqual,
  POLL_FALLBACK_MS,
  SSE_WATCHDOG_MS,
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
  /** Transient server-side conditions to explain to the user. */
  notice: "none" | "unavailable" | "toomany";
  serverOffsetMs: number;
}

const INITIAL: TrackingState = {
  connection: "connecting",
  tracking: false,
  position: null,
  route: null,
  destination: null,
  endedReason: null,
  notice: "none",
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
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let polling = false;
    let pollFailures = 0;
    let failures = 0;
    let watchdog: ReturnType<typeof setTimeout> | undefined;

    const base = `/api/errands/${errandId}/tracking`;

    const applySnapshot = (s: TrackSnapshot) => {
      const serverMs = typeof s.serverTime === "number" ? s.serverTime : new Date(s.serverTime).getTime();
      setState((prev) => ({
        ...prev,
        tracking: s.tracking,
        position: isNewerOrEqual(s.position, prev.position) ? s.position : prev.position,
        route: s.route && !isRouteNewerOrEqual(s.route, prev.route) ? prev.route : s.route,
        notice: "none",
        destination: s.destination,
        serverOffsetMs: Number.isNaN(serverMs) ? prev.serverOffsetMs : serverMs - Date.now(),
      }));
    };

    const end = (reason: string) => {
      endedRef.current = true;
      source?.close();
      clearTimeout(pollTimer);
      clearTimeout(retryTimer);
      clearTimeout(watchdog);
      setState((prev) => ({ ...prev, connection: "ended", endedReason: reason }));
    };

    type Probe = "ok" | "terminal" | "unavailable" | "toomany" | "error";

    // 403/404/409 are terminal; 503 TRACKING_UNAVAILABLE is transient; 429 means back off hard.
    const pollOnce = async (): Promise<Probe> => {
      const res = await api<TrackSnapshot>("GET", `${base}/snapshot`, { quiet: true });
      if (closed || endedRef.current) return "terminal";
      if (res.ok && res.data) {
        applySnapshot(res.data);
        if (res.data.status !== "Picked Up") {
          end("status");
          return "terminal";
        }
        return "ok";
      }
      if (res.status === 403 || res.status === 404 || res.status === 409) {
        end("unavailable");
        return "terminal";
      }
      if (res.status === 503 || res.status === 429) {
        const notice = res.status === 503 ? "unavailable" : "toomany";
        setState((prev) => ({ ...prev, notice }));
        return res.status === 503 ? "unavailable" : "toomany";
      }
      return "error";
    };

    const pollLoop = async () => {
      const r = await pollOnce();
      if (closed || endedRef.current) return;
      pollFailures = r === "ok" ? 0 : pollFailures + 1;
      const delay =
        r === "ok"
          ? POLL_FALLBACK_MS
          : Math.max(r === "toomany" ? 30_000 : POLL_FALLBACK_MS, backoffMs(pollFailures, Math.random()));
      pollTimer = setTimeout(() => void pollLoop(), delay);
    };

    const startPolling = () => {
      if (polling) return;
      polling = true;
      source?.close();
      clearTimeout(watchdog);
      clearTimeout(retryTimer);
      setState((prev) => ({ ...prev, connection: "polling" }));
      void pollLoop();
    };

    const connect = () => {
      if (closed || endedRef.current) return;
      if (typeof EventSource === "undefined") {
        startPolling();
        return;
      }
      const es = new EventSource(base, { withCredentials: true });
      source = es;
      // Any event (including keepalive) proves the stream is flowing; silence means it is buffered or dead.
      const arm = () => {
        clearTimeout(watchdog);
        watchdog = setTimeout(() => {
          if (!closed && !endedRef.current) startPolling();
        }, SSE_WATCHDOG_MS);
      };
      arm();
      es.addEventListener("keepalive", arm);
      es.onmessage = arm;
      es.onopen = () => {
        failures = 0;
        setState((prev) => ({ ...prev, connection: "live" }));
      };
      es.addEventListener("snapshot", (e) => {
        arm();
        const s = parse<TrackSnapshot>((e as MessageEvent).data);
        if (s) applySnapshot(s);
      });
      es.addEventListener("location", (e) => {
        arm();
        const p = parse<TrackPosition>((e as MessageEvent).data);
        if (p)
          setState((prev) =>
            isNewerOrEqual(p, prev.position) ? { ...prev, tracking: true, position: p } : prev,
          );
      });
      es.addEventListener("route", (e) => {
        arm();
        const r = parse<TrackRoute>((e as MessageEvent).data);
        if (r) setState((prev) => (isRouteNewerOrEqual(r, prev.route) ? { ...prev, route: r } : prev));
      });
      es.addEventListener("ended", (e) => {
        arm();
        const d = parse<{ reason?: string }>((e as MessageEvent).data);
        end(d?.reason ?? "ended");
      });
      es.onerror = () => {
        es.close();
        clearTimeout(watchdog);
        if (closed || endedRef.current) return;
        failures += 1;
        // EventSource hides the HTTP status, so ask the snapshot endpoint why the stream failed.
        void pollOnce().then((r) => {
          if (closed || endedRef.current || r === "terminal") return;
          if (r === "toomany" || r === "unavailable" || failures >= SSE_MAX_FAILURES) {
            startPolling();
            return;
          }
          retryTimer = setTimeout(connect, backoffMs(failures - 1, Math.random()));
        });
      };
    };

    // First paint from the plain snapshot, then the stream.
    void pollOnce();
    connect();

    return () => {
      closed = true;
      source?.close();
      clearTimeout(retryTimer);
      clearTimeout(watchdog);
      clearTimeout(pollTimer);
    };
  }, [errandId, enabled]);

  return enabled ? state : INITIAL;
}
