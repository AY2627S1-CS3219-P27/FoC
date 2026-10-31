"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import {
  ageSeconds,
  formatAge,
  formatDistance,
  formatEta,
  isStale,
  resolveTileConfig,
} from "@/lib/tracking";
import { useTracking } from "./use-tracking";

const TrackingMap = dynamic(() => import("./tracking-map"), {
  ssr: false,
  loading: () => <div className="h-64 w-full rounded-lg bg-border/40 animate-pulse" aria-hidden />,
});

// NEXT_PUBLIC_* vars must be referenced literally so Next can inline them.
const TILES = resolveTileConfig({
  url: process.env.NEXT_PUBLIC_MAP_TILE_URL,
  attribution: process.env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION,
  nodeEnv: process.env.NODE_ENV,
});

export function TrackingMapCard({ errandId }: { errandId: string }) {
  const t = useTracking(errandId, true);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const age = t.position ? ageSeconds(t.position.ts, now + t.serverOffsetMs) : null;
  const stale = isStale(age);

  let statusText: string;
  if (t.connection === "ended") statusText = "Tracking has ended for this errand.";
  else if (!t.tracking || !t.position)
    statusText = "The courier has not shared a live location. Tracking is optional.";
  else statusText = `Courier last seen ${formatAge(age)}${stale ? " (location may be out of date)" : ""}`;

  return (
    <section
      aria-labelledby={`track-${errandId}`}
      className="mt-6 rounded-xl border border-border bg-surface p-4 space-y-3"
    >
      <div className="flex items-center justify-between gap-2">
        <h4 id={`track-${errandId}`} className="text-sm font-semibold">
          Courier location
        </h4>
        {t.connection === "polling" && (
          <span className="text-xs text-muted">Refreshing every few seconds</span>
        )}
        {t.connection === "connecting" && <span className="text-xs text-muted">Connecting…</span>}
      </div>

      {TILES ? (
        <div role="img" aria-label="Map showing the courier's position">
          <TrackingMap
            tiles={TILES}
            position={t.position}
            stale={stale}
            route={t.route}
            destination={t.destination}
          />
        </div>
      ) : (
        <div
          role="status"
          className="flex h-40 items-center justify-center rounded-lg border border-dashed border-border px-4 text-center text-sm text-muted"
        >
          Map tiles not configured. Set NEXT_PUBLIC_MAP_TILE_URL and NEXT_PUBLIC_MAP_TILE_ATTRIBUTION.
        </div>
      )}

      <p role="status" aria-live="polite" className="text-sm">
        {statusText}
      </p>
      {t.route && t.connection !== "ended" && (
        <p className="text-sm text-muted">
          About {formatEta(t.route.durationS)} away · {formatDistance(t.route.distanceM)}
        </p>
      )}
    </section>
  );
}
