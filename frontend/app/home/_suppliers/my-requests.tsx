"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { EmptyState, Pill } from "@/components/ui/layout";

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

const STATE_TONES: Record<MyRequest["state"], React.ComponentProps<typeof Pill>["tone"]> = {
  Pending: "orange",
  Approved: "success",
  Denied: "danger",
  Withdrawn: "neutral",
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
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const res = await api<{ items: MyRequest[] }>("GET", "/api/supplier-requests/mine?limit=50", { quiet: true });
    setLoading(false);
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
    if (res.ok) toast.success("Request withdrawn");
    else setError(`${res.status} ${res.message ?? "Could not withdraw."}`);
    await load();
  }

  if (loading) return <div role="status" aria-label="Loading" className="skeleton h-16 rounded-2xl" />;
  if (error) return <EmptyState tone="error" title="Could not load your requests" body={error} />;
  if (items.length === 0)
    return <EmptyState title="No requests yet" body="Suggestions you send to the admins will appear here." />;

  return (
    <ul className="stagger space-y-2">
      {items.map((r) => (
        <li key={r.id} className="rounded-2xl border border-border bg-surface p-4 text-sm shadow-card">
          <div className="flex items-start justify-between gap-3">
            <span className="min-w-0 font-medium break-words">
              {r.type === "Create"
                ? `New: ${String(r.values.name ?? "")}`
                : `Edit: ${supplierName(r.supplierId ?? "") ?? r.supplierId?.slice(0, 8)}`}
            </span>
            <Pill tone={STATE_TONES[r.state]} className="shrink-0">
              {r.state}
            </Pill>
          </div>
          <p className="mt-1 text-xs break-words text-muted">
            {Object.keys(r.values).join(", ")} · sent {new Date(r.submittedAt).toLocaleString()}
          </p>
          {r.denialReason && <p className="mt-1 text-xs break-words text-danger">Reason: {r.denialReason}</p>}
          {r.state === "Pending" && (
            <Button intent="danger-outline" size="xs" onClick={() => withdraw(r.id)} className="mt-3">
              Withdraw
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
