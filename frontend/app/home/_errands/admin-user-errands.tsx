"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
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
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 scrim" onClick={onClose} />
      <div className="relative w-full max-w-3xl bg-background border-l border-border overflow-y-auto p-6 fade-in">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-xl font-bold">Errands of {user.displayName}</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="btn-press flex items-center justify-center w-8 h-8 rounded-full bg-surface text-muted hover:text-foreground"
          >
            ✕
          </button>
        </div>
        <p className="text-sm text-muted mb-4">
          {user.email} · admin view, includes the internal sub-state
        </p>

        <div className="flex flex-wrap gap-3 mb-4">
          <select value={role} onChange={(e) => setRole(e.target.value)} className={inputClass}>
            <option value="">As requester or courier</option>
            <option value="requester">As requester</option>
            <option value="courier">As courier</option>
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputClass}>
            <option value="">Any status</option>
            {ERRAND_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {loading ? (
          <p className="text-muted py-8 text-center">Loading…</p>
        ) : error ? (
          <p role="alert" className="text-danger text-sm py-8 text-center">
            {error}
          </p>
        ) : items.length === 0 ? (
          <p className="text-muted py-8 text-center">No errands.</p>
        ) : (
          <div className="rounded-2xl border border-border bg-surface overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted">
                  <th className="px-3 py-2 font-medium">Errand</th>
                  <th className="px-3 py-2 font-medium">As</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Internal</th>
                  <th className="px-3 py-2 font-medium">Route</th>
                  <th className="px-3 py-2 font-medium">Credits</th>
                  <th className="px-3 py-2 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody>
                {items.map((e) => (
                  <tr key={e.id} className="border-b border-border last:border-b-0 align-top">
                    <td className="px-3 py-2 font-mono text-xs">{shortId(e.id)}</td>
                    <td className="px-3 py-2">{e.requesterId === user.uuid ? "Requester" : "Courier"}</td>
                    <td className="px-3 py-2">
                      <StatusBadge status={e.status} />
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {e.internalStatus}
                      {e.cancellationReason && (
                        <span className="block text-muted">{e.cancellationReason}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {e.pickupLocation ?? "—"} → {e.deliveryLocation}
                    </td>
                    <td className="px-3 py-2">{e.rewardCredits}</td>
                    <td className="px-3 py-2 text-muted whitespace-nowrap">{formatTime(e.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
