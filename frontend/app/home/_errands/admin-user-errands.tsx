"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { EmptyState } from "@/components/ui/layout";
import { Sheet } from "@/components/ui/sheet";
import { ERRAND_STATUSES, type AdminErrand, type Page } from "./types";
import { formatTime, inputClass, shortId, StatusBadge } from "./ui";

export function AdminUserErrands({
  user,
  onClose,
}: {
  user: { uuid: string; displayName: string; email: string };
  onClose: () => void;
}) {
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [items, setItems] = useState<AdminErrand[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ limit: "50" });
    if (role) params.set("role", role);
    if (status) params.set("status", status);
    const res = await api<Page<AdminErrand>>("GET", `/api/admin/users/${user.uuid}/errands?${params}`);
    setLoading(false);
    if (res.ok && res.data) {
      setItems(res.data.items);
      setError("");
    } else {
      setItems([]);
      setError(`${res.status} ${res.code ?? ""}: ${res.message ?? "Could not load errands."}`);
    }
  }, [user.uuid, role, status]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <Sheet
      wide
      title={`Errands of ${user.displayName}`}
      description={`${user.email} · admin view, includes the internal sub-state`}
      onClose={onClose}
    >
      <div className="mb-4 grid gap-3 sm:flex sm:flex-wrap">
        <select value={role} onChange={(e) => setRole(e.target.value)} className={inputClass} aria-label="Role">
          <option value="">As requester or courier</option>
          <option value="requester">As requester</option>
          <option value="courier">As courier</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputClass} aria-label="Status">
          <option value="">Any status</option>
          {ERRAND_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div role="status" aria-label="Loading" className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-10 rounded-xl" />
          ))}
        </div>
      ) : error ? (
        <EmptyState tone="error" title="Could not load errands" body={error} />
      ) : items.length === 0 ? (
        <EmptyState title="No errands" body="Nothing matches these filters." />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs tracking-wide text-muted uppercase">
                <th className="px-3 py-2.5 font-medium">Errand</th>
                <th className="px-3 py-2.5 font-medium">As</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 font-medium">Internal</th>
                <th className="px-3 py-2.5 font-medium">Route</th>
                <th className="px-3 py-2.5 text-right font-medium">Credits</th>
                <th className="px-3 py-2.5 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.id} className="border-b border-border align-top last:border-b-0">
                  <td className="px-3 py-2.5 font-mono text-xs">{shortId(e.id)}</td>
                  <td className="px-3 py-2.5">{e.requesterId === user.uuid ? "Requester" : "Courier"}</td>
                  <td className="px-3 py-2.5">
                    <StatusBadge status={e.status} />
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs">
                    {e.internalStatus}
                    {e.cancellationReason && (
                      <span className="block max-w-48 font-sans break-words text-muted">{e.cancellationReason}</span>
                    )}
                  </td>
                  <td className="min-w-40 px-3 py-2.5 break-words">
                    {e.pickupLocation ?? "—"} → {e.deliveryLocation}
                  </td>
                  <td className="tabular px-3 py-2.5 text-right">{e.rewardCredits.toLocaleString()}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-muted">{formatTime(e.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Sheet>
  );
}
