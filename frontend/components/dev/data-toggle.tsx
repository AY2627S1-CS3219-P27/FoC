"use client";

import { useSyncExternalStore } from "react";
import { DATASETS } from "@/lib/dev-datasets";

const LABELS: Record<(typeof DATASETS)[number], string> = {
  demo: "Demo data",
  worst: "Worst case",
  empty: "Empty",
  one: "One",
  huge: "1,000 rows",
};

const subscribe = () => () => {};
const current = () => new URLSearchParams(window.location.search).get("data");

// Dev-only chrome: switches /home between the real API and a fixture via ?data=.
export function DataToggle() {
  const active = useSyncExternalStore(subscribe, current, () => null);

  function pick(dataset: string | null) {
    const params = new URLSearchParams(window.location.search);
    if (dataset) params.set("data", dataset);
    else params.delete("data");
    const qs = params.toString();
    window.location.replace(`/home${qs ? `?${qs}` : ""}`);
  }

  return (
    <div
      style={{ fontFamily: "system-ui, sans-serif" }}
      className="fixed bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] left-1/2 z-[60] md:bottom-4 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 gap-0.5 overflow-x-auto rounded-full bg-neutral-200 p-0.5 text-xs text-neutral-700 shadow"
    >
      {[null, ...DATASETS].map((d) => (
        <button
          key={d ?? "live"}
          type="button"
          onClick={() => pick(d)}
          className={`shrink-0 rounded-full px-2.5 py-1 ${active === d ? "bg-white text-neutral-950 shadow-sm" : ""}`}
        >
          {d ? LABELS[d] : "Live API"}
        </button>
      ))}
    </div>
  );
}
