"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api, errorText } from "@/lib/api";
import { formatTime } from "../_errands/ui";
import { Button } from "@/components/ui/button";
import { FilterSelect, FormError, textareaClass } from "@/components/ui/field";
import { EmptyState, PageHeader, Pill, SkeletonList } from "@/components/ui/layout";

type RequestType = "Create" | "Update" | "StatusChange";

interface SupplierRequest {
  id: string;
  type: RequestType;
  state: string;
  supplierId: string | null;
  supplierVersion: number | null;
  values: Record<string, unknown>;
  submittedBy: string;
  submittedAt: string;
}

interface Named {
  id: string;
  name?: string;
  shortName?: string;
}

export interface RequestSupplier {
  id: string;
  name: string;
  displayName: string;
  kind: string;
  floor: string;
  status: string;
  building: { id: string; shortName: string } | null;
  categories: { id: string; name: string }[];
}

// Readable names for the request fields, which arrive as API keys.
const FIELD_LABELS: Record<string, string> = {
  name: "Name",
  kind: "Type",
  categoryIds: "Categories",
  buildingId: "Building",
  floor: "Floor",
  locationDescription: "Location",
  coordinates: "Coordinates",
  photoUrl: "Photo URL",
  status: "Status",
};

const TYPE_LABELS: Record<RequestType, string> = {
  Create: "New supplier",
  Update: "Edit supplier",
  StatusChange: "Status change",
};

export function SupplierRequestsTab({
  suppliers,
  buildings,
  categories,
  users,
  onResolved,
}: {
  suppliers: RequestSupplier[];
  buildings: Named[];
  categories: Named[];
  users: { uuid: string; displayName: string; email: string }[];
  onResolved: () => void;
}) {
  const [type, setType] = useState<"" | RequestType>("");
  const [items, setItems] = useState<SupplierRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await api<{ items: SupplierRequest[]; total: number }>(
      "GET",
      `/api/supplier-requests?limit=50${type ? `&type=${type}` : ""}`,
    );
    setLoading(false);
    if (res.ok && res.data) {
      setItems(res.data.items);
      setTotal(res.data.total);
      setError("");
    } else {
      setError(errorText(res, "Could not load requests."));
    }
  }, [type]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const label = {
    building: (id: unknown) => buildings.find((b) => b.id === id)?.shortName ?? String(id),
    category: (id: unknown) => categories.find((c) => c.id === id)?.name ?? String(id),
    user: (id: string) => {
      const u = users.find((x) => x.uuid === id);
      return u ? `${u.displayName} (${u.email})` : "Unknown user";
    },
  };

  return (
    <div>
      <PageHeader
        title="Requests"
        subtitle={`${total} pending supplier request${total !== 1 ? "s" : ""} from students`}
      />

      <div className="mb-4 flex">
        <FilterSelect
          label="Request type"
          value={type}
          onValueChange={(v) => {
            setLoading(true);
            setType(v as "" | RequestType);
          }}
          options={[
            { value: "", label: "All types" },
            ...(Object.keys(TYPE_LABELS) as RequestType[]).map((t) => ({ value: t, label: TYPE_LABELS[t] })),
          ]}
        />
      </div>

      {loading ? (
        <SkeletonList count={3} />
      ) : error ? (
        <EmptyState tone="error" title="Couldn't load requests" body={error} />
      ) : items.length === 0 ? (
        <EmptyState title="All caught up" body="There are no pending supplier requests." />
      ) : (
        <div className="stagger grid gap-5">
          {items.map((r) => (
            <RequestCard
              key={r.id}
              request={r}
              supplier={suppliers.find((s) => s.id === r.supplierId)}
              label={label}
              onDone={() => {
                void load();
                onResolved();
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RequestCard({
  request,
  supplier,
  label,
  onDone,
}: {
  request: SupplierRequest;
  supplier: RequestSupplier | undefined;
  label: {
    building: (id: unknown) => string;
    category: (id: unknown) => string;
    user: (id: string) => string;
  };
  onDone: () => void;
}) {
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);

  // The list view leaves out fields such as locationDescription, so read the full supplier for the comparison.
  useEffect(() => {
    if (!request.supplierId) return;
    api<Record<string, unknown>>("GET", `/api/suppliers/${request.supplierId}`).then(
      (res) => setDetail(res.data),
    );
  }, [request.supplierId]);

  function show(key: string, value: unknown): string {
    const empty = value === null || value === undefined || value === "";
    if (empty || (Array.isArray(value) && value.length === 0)) return "—";
    if (key === "buildingId") return label.building(value);
    if (key === "categoryIds" && Array.isArray(value)) return value.map(label.category).join(", ");
    if (key === "coordinates" && typeof value === "object") {
      const c = value as { latitude?: number; longitude?: number };
      return `${c.latitude}, ${c.longitude}`;
    }
    return typeof value === "object" ? JSON.stringify(value) : String(value);
  }

  function current(key: string): unknown {
    const s = detail ?? (supplier as unknown as Record<string, unknown> | undefined);
    if (!s) return undefined;
    if (key === "buildingId") return (s.building as { id?: string } | null)?.id;
    if (key === "categoryIds") return (s.categories as { id: string }[] | undefined)?.map((c) => c.id);
    return s[key];
  }

  async function resolve(action: "approve" | "deny") {
    setPending(true);
    setError("");
    const res = await api("POST", `/api/supplier-requests/${request.id}/${action}`, {
      body: action === "deny" ? { reason: reason.trim() } : undefined,
    });
    setPending(false);
    if (res.ok) {
      toast.success(action === "approve" ? "Request approved" : "Request denied");
      onDone();
    } else setError(errorText(res, `Could not ${action} the request.`));
  }

  const showCurrent = request.type !== "Create" && !!(detail ?? supplier);

  return (
    <article className="min-w-0 overflow-hidden rounded-2xl bg-surface">
      <header className="px-4 pt-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <h3 className="min-w-0 text-[17px] font-semibold break-words">
            {request.type === "Create"
              ? show("name", request.values.name)
              : String(detail?.displayName ?? supplier?.displayName ?? "Unknown supplier")}
          </h3>
          <Pill tone="blue" className="shrink-0 whitespace-nowrap">
            {TYPE_LABELS[request.type]}
          </Pill>
        </div>
        <p className="mt-0.5 text-[13px] break-words text-muted">
          {label.user(request.submittedBy)} · {formatTime(request.submittedAt)}
          {request.supplierVersion !== null && ` · version ${request.supplierVersion}`}
        </p>
      </header>

      {/* Each field shows what it would become, with the current value underneath for edits. */}
      <dl className="pl-4 [&>div+div]:border-t">
        {Object.entries(request.values).map(([key, value]) => (
          <div key={key} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3 border-border py-2.5 pr-4">
            <dt className="text-[13px] text-muted">{FIELD_LABELS[key] ?? key}</dt>
            <dd className="min-w-0 text-[15px] break-words">
              {show(key, value)}
              {showCurrent && (
                <span className="mt-0.5 block text-[13px] text-muted">Now: {show(key, current(key))}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>

      <div className="border-t border-border p-4">
        {denying && (
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            rows={2}
            autoFocus
            placeholder="Reason for denying (required)"
            aria-label="Reason for denying"
            className={`mb-3 w-full ${textareaClass}`}
          />
        )}
        <div className="grid grid-cols-2 gap-2">
          {!denying ? (
            <>
              <Button intent="danger-outline" disabled={pending} onClick={() => setDenying(true)}>
                Deny…
              </Button>
              <Button intent="success" disabled={pending} onClick={() => resolve("approve")}>
                Approve
              </Button>
            </>
          ) : (
            <>
              <Button intent="outline" disabled={pending} onClick={() => setDenying(false)}>
                Back
              </Button>
              <Button intent="danger" disabled={pending || !reason.trim()} onClick={() => resolve("deny")}>
                Deny request
              </Button>
            </>
          )}
        </div>
        {error && (
          <div className="mt-2">
            <FormError>{error}</FormError>
          </div>
        )}
      </div>
    </article>
  );
}
