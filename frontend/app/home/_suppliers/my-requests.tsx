"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

interface MyRequest {
  id: string;
  type: "Create" | "Update" | "StatusChange";
  state: "Pending" | "Approved" | "Denied" | "Withdrawn";
  supplierId: string | null;
  values: Record<string, unknown>;
  submittedAt: string;
  resolvedAt: string | null;
  denialReason: string | null;
}

const STATE_STYLES: Record<MyRequest["state"], string> = {
  Pending: "bg-nus-orange/15 text-nus-orange",
  Approved: "bg-success/15 text-success",
  Denied: "bg-danger/15 text-danger",
  Withdrawn: "bg-muted/15 text-muted",
};

export function MyRequests({
  supplierName,
  reloadKey,
}: {
  supplierName: (id: string) => string | undefined;
  reloadKey: number;
}) {
  const [items, setItems] = useState<MyRequest[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await api<{ items: MyRequest[] }>("GET", "/api/supplier-requests/mine?limit=50", { quiet: true });
    if (res.ok && res.data) {
      setItems(res.data.items);
      setError("");
    } else {
      setError(`${res.status} ${res.message ?? "Could not load your requests."}`);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load, reloadKey]);

  async function withdraw(id: string) {
    const res = await api("POST", `/api/supplier-requests/${id}/withdraw`);
    if (!res.ok) setError(`${res.status} ${res.message ?? "Could not withdraw."}`);
    await load();
  }

  if (error) return <p role="alert" className="text-sm text-danger">{error}</p>;
  if (items.length === 0) return <p className="text-sm text-muted">You have not sent any supplier requests yet.</p>;

  return (
    <ul className="space-y-2">
      {items.map((r) => (
        <li key={r.id} className="rounded-xl border border-border bg-surface p-3 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">
              {r.type === "Create"
                ? `New: ${String(r.values.name ?? "")}`
                : `Edit: ${supplierName(r.supplierId ?? "") ?? r.supplierId?.slice(0, 8)}`}
            </span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATE_STYLES[r.state]}`}>{r.state}</span>
          </div>
          <p className="text-xs text-muted mt-1">
            {Object.keys(r.values).join(", ")} · sent {new Date(r.submittedAt).toLocaleString()}
          </p>
          {r.denialReason && <p className="text-xs text-danger mt-1">Reason: {r.denialReason}</p>}
          {r.state === "Pending" && (
            <button onClick={() => withdraw(r.id)} className="btn-press mt-2 text-xs text-danger hover:underline">
              Withdraw
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
