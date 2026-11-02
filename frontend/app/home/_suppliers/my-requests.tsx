"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api, errorText } from "@/lib/api";
import { formatTime } from "../_errands/ui";
import { Button } from "@/components/ui/button";
import { EmptyState, Pill, SkeletonList } from "@/components/ui/layout";

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
    const res = await api<{ items: MyRequest[] }>("GET", "/api/supplier-requests/mine?limit=50");
    setLoading(false);
    if (res.ok && res.data) {
      setItems(res.data.items);
      setError("");
    } else {
      setError(errorText(res, "Could not load your requests."));
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load, reloadKey]);

  async function withdraw(id: string) {
    const res = await api("POST", `/api/supplier-requests/${id}/withdraw`);
    if (res.ok) toast.success("Request withdrawn");
    else setError(errorText(res, "Could not withdraw."));
    await load();
  }

  if (loading) return <SkeletonList count={2} />;
  if (error) return <EmptyState tone="error" title="Couldn't load your requests" body={error} />;
  if (items.length === 0)
    return <EmptyState title="No requests yet" body="Suggestions you send to the admins will appear here." />;

  return (
    <ul className="stagger overflow-hidden rounded-2xl bg-surface [&>li+li>div]:border-t">
      {items.map((r) => (
        <li key={r.id} className="pl-4">
          <div className="border-border py-3 pr-4">
            <div className="flex items-start justify-between gap-3">
              <span className="min-w-0 text-[15px] font-semibold break-words">
                {r.type === "Create"
                  ? `New: ${String(r.values.name ?? "")}`
                  : `Edit: ${supplierName(r.supplierId ?? "") ?? "Unknown supplier"}`}
              </span>
              <Pill tone={STATE_TONES[r.state]} className="shrink-0">
                {r.state}
              </Pill>
            </div>
            <p className="mt-0.5 text-[13px] break-words text-muted">
              {Object.keys(r.values).map(fieldLabel).join(", ")} · sent {formatTime(r.submittedAt)}
            </p>
            {r.denialReason && <p className="mt-1 text-[13px] break-words text-danger">Reason: {r.denialReason}</p>}
            {r.state === "Pending" && (
              <Button intent="danger-outline" size="xs" onClick={() => withdraw(r.id)} className="mt-2.5">
                Withdraw
              </Button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

const FIELD_NAMES: Record<string, string> = {
  name: "name",
  kind: "type",
  categoryIds: "categories",
  buildingId: "building",
  floor: "floor",
  locationDescription: "location",
  coordinates: "coordinates",
  photoUrl: "photo",
};

const fieldLabel = (key: string) => FIELD_NAMES[key] ?? key;
