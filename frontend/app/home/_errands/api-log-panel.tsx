"use client";

import { clsx } from "clsx";
import { useState } from "react";
import { clearApiLog, useApiLog } from "@/lib/api";

function statusClass(status: number) {
  if (status >= 200 && status < 300) return "bg-success/15 text-success";
  if (status >= 400 && status < 500) return "bg-nus-orange/15 text-nus-orange";
  return "bg-danger/15 text-danger";
}

export function ApiLogPanel() {
  const entries = useApiLog();
  const [open, setOpen] = useState(false);

  return (
    <div
      className={clsx(
        "fixed right-4 bottom-4 z-40",
        open ? "w-[min(30rem,calc(100vw-2rem))]" : "w-auto",
      )}
    >
      <div className="glass-panel overflow-hidden rounded-2xl border border-border shadow-raised">
        <div className="flex items-center justify-between gap-3 px-3 py-2">
          <button
            onClick={() => setOpen((o) => !o)}
            className="btn-press flex items-center gap-2 rounded-lg px-1.5 py-1 text-sm font-semibold"
            aria-expanded={open}
          >
            <span
              aria-hidden="true"
              className={clsx("size-2 rounded-full", entries.length ? "bg-success" : "bg-muted/50")}
            />
            API log
            <span className="tabular rounded-full bg-surface px-1.5 text-xs text-muted">{entries.length}</span>
            <span aria-hidden="true" className={clsx("text-muted transition-transform duration-200", open && "rotate-90")}>
              ▸
            </span>
          </button>
          {open && entries.length > 0 && (
            <button onClick={clearApiLog} className="btn-press rounded-lg px-2 py-1 text-xs text-muted hover:text-foreground">
              Clear
            </button>
          )}
        </div>
        {open && (
          <ol className="max-h-80 overflow-y-auto border-t border-border font-mono text-xs">
            {entries.length === 0 && <li className="px-4 py-3 text-muted">No calls yet.</li>}
            {entries.map((e) => (
              <li key={e.id} className="border-b border-border px-4 py-2 last:border-b-0">
                <div className="flex min-w-0 items-center gap-2">
                  <span className={`shrink-0 rounded px-1.5 ${statusClass(e.status)}`}>{e.status || "ERR"}</span>
                  <span className="shrink-0 font-semibold">{e.method}</span>
                  <span className="min-w-0 truncate" title={e.path}>{e.path}</span>
                  <span className="ml-auto shrink-0 text-muted">{e.at.toLocaleTimeString()}</span>
                </div>
                {(e.code || e.replayed || e.idempotencyKey) && (
                  <div className="mt-0.5 break-words text-muted">
                    {e.code && <span className="text-danger">{e.code} </span>}
                    {e.replayed && <span className="text-success">Idempotent-Replayed </span>}
                    {e.idempotencyKey && <span>key {e.idempotencyKey.slice(0, 8)}</span>}
                  </div>
                )}
                {e.message && <div className="mt-0.5 break-words text-muted">{e.message}</div>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
