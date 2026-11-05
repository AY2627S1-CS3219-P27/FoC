"use client";

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
    <div className="fixed bottom-4 right-4 z-40 w-[min(30rem,calc(100vw-2rem))]">
      <div className="rounded-2xl border border-border bg-surface shadow-lg">
        <div className="flex items-center justify-between px-4 py-2.5">
          <button
            onClick={() => setOpen((o) => !o)}
            className="btn-press text-sm font-semibold"
            aria-expanded={open}
          >
            API log ({entries.length}) {open ? "▾" : "▸"}
          </button>
          {open && entries.length > 0 && (
            <button onClick={clearApiLog} className="text-xs text-muted hover:text-foreground">
              Clear
            </button>
          )}
        </div>
        {open && (
          <ol className="max-h-80 overflow-y-auto border-t border-border text-xs font-mono">
            {entries.length === 0 && <li className="px-4 py-3 text-muted">No calls yet.</li>}
            {entries.map((e) => (
              <li key={e.id} className="px-4 py-2 border-b border-border last:border-b-0">
                <div className="flex items-center gap-2">
                  <span className={`px-1.5 rounded ${statusClass(e.status)}`}>{e.status || "ERR"}</span>
                  <span className="font-semibold">{e.method}</span>
                  <span className="truncate">{e.path}</span>
                  <span className="ml-auto text-muted">{e.at.toLocaleTimeString()}</span>
                </div>
                {(e.code || e.replayed || e.idempotencyKey) && (
                  <div className="mt-0.5 text-muted">
                    {e.code && <span className="text-danger">{e.code} </span>}
                    {e.replayed && <span className="text-success">Idempotent-Replayed </span>}
                    {e.idempotencyKey && <span>key {e.idempotencyKey.slice(0, 8)}</span>}
                  </div>
                )}
                {e.message && <div className="mt-0.5 text-muted break-words">{e.message}</div>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
