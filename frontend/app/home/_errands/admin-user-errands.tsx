"use client";

import { useCallback, useEffect, useState } from "react";
import { api, errorText } from "@/lib/api";
import { FilterSelect } from "@/components/ui/field";
import { BoxIcon } from "@/components/ui/icons";
import { EmptyState, IconTile, SkeletonList } from "@/components/ui/layout";
import { ERRAND_STATUSES, formatDelivery, type AdminErrand, type Page } from "./types";
import { formatCredits, formatTime, shortId, statusColor, StatusBadge } from "./ui";

// Pushed inside a user's sheet: their errands as requester or courier, with the internal sub-state admins need.
export function AdminUserErrands({ user }: { user: { uuid: string; displayName: string; email: string } }) {
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
      setError(errorText(res, "Could not load errands."));
    }
  }, [user.uuid, role, status]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div>
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
        <FilterSelect label="Role" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">As requester or courier</option>
          <option value="requester">As requester</option>
          <option value="courier">As courier</option>
        </FilterSelect>
        <FilterSelect label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Any status</option>
          {ERRAND_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </FilterSelect>
      </div>

      {loading ? (
        <SkeletonList count={3} />
      ) : error ? (
        <EmptyState tone="error" title="Couldn't load errands" body={error} />
      ) : items.length === 0 ? (
        <EmptyState title="No errands" body="Nothing matches these filters." />
      ) : (
        <ul className="overflow-hidden rounded-2xl bg-surface [&>li+li_.row-content]:border-t">
          {items.map((e) => (
            <li key={e.id} className="flex items-start pl-4">
              <span className="pt-3">
                <IconTile color={statusColor(e.status)}>
                  <BoxIcon size={17} />
                </IconTile>
              </span>
              <div className="row-content ml-3 min-w-0 flex-1 border-border py-3 pr-4">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-[15px] font-semibold">
                    {e.pickupLocation ?? "—"} → {formatDelivery(e)}
                  </span>
                  <span className="tabular shrink-0 text-[15px] font-semibold text-nus-orange">
                    {formatCredits(e.rewardCredits)}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
                  <StatusBadge status={e.status} />
                  <span className="font-mono text-xs">{e.internalStatus}</span>
                  <span>· {e.requesterId === user.uuid ? "Requester" : "Courier"}</span>
                </div>
                {e.cancellationReason && (
                  <p className="mt-1 text-[13px] break-words text-muted">{e.cancellationReason}</p>
                )}
                <p className="mt-1 text-xs text-muted">
                  {shortId(e.id)} · updated {formatTime(e.updatedAt)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
