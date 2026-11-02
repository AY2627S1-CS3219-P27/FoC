"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { FormError, inputClass, textareaClass } from "@/components/ui/field";
import { EmptyState, PageHeader, Pill, SkeletonGrid } from "@/components/ui/layout";

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
      setError(`${res.status} ${res.message ?? res.code ?? "Could not load requests."}`);
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
        title="Supplier requests"
        subtitle={`${total} pending request${total !== 1 ? "s" : ""} from students.`}
        actions={
          <select
            value={type}
            aria-label="Request type"
            onChange={(e) => {
              setLoading(true);
              setType(e.target.value as "" | RequestType);
            }}
            className={inputClass}
          >
            <option value="">All types</option>
            {(Object.keys(TYPE_LABELS) as RequestType[]).map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        }
      />

      {loading ? (
        <SkeletonGrid count={4} className="lg:grid-cols-2" />
      ) : error ? (
        <EmptyState tone="error" title="Could not load requests" body={error} />
      ) : items.length === 0 ? (
        <EmptyState title="All caught up" body="There are no pending supplier requests." />
      ) : (
        <div className="stagger grid gap-4 lg:grid-cols-2">
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
    } else setError(`${res.status} ${res.message ?? res.code ?? `Could not ${action}.`}`);
  }

  const showCurrent = request.type !== "Create" && !!(detail ?? supplier);

  return (
    <div className="flex min-w-0 flex-col rounded-2xl border border-border bg-surface p-5 shadow-card">
      <div className="mb-1 flex items-start justify-between gap-3">
        <h3 className="min-w-0 font-semibold break-words">
          {request.type === "Create"
            ? show("name", request.values.name)
            : String(detail?.displayName ?? supplier?.displayName ?? `Supplier ${request.supplierId?.slice(0, 8)}`)}
        </h3>
        <Pill tone="blue" className="shrink-0 whitespace-nowrap">
          {TYPE_LABELS[request.type]}
        </Pill>
      </div>
      <p className="mb-4 text-xs break-words text-muted">
        By {label.user(request.submittedBy)} · {new Date(request.submittedAt).toLocaleString()}
        {request.supplierVersion !== null && ` · against version ${request.supplierVersion}`}
      </p>

      <div className="mb-4 overflow-x-auto">
        <table className="w-full table-fixed text-sm">
          <thead>
            <tr className="text-left text-xs tracking-wide text-muted uppercase">
              <th className="w-24 py-1 pr-3 font-medium sm:w-1/4">Field</th>
              {showCurrent && <th className="py-1 pr-3 font-medium">Current</th>}
              <th className="py-1 font-medium">{request.type === "Create" ? "Value" : "Requested"}</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(request.values).map(([key, value]) => (
              <tr key={key} className="border-t border-border align-top">
                <td className="py-2 pr-3 break-words text-muted">{FIELD_LABELS[key] ?? key}</td>
                {showCurrent && <td className="py-2 pr-3 break-words">{show(key, current(key))}</td>}
                <td className="py-2 font-medium break-words">{show(key, value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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

      <div className="mt-auto flex flex-wrap gap-2">
        {!denying ? (
          <>
            <Button size="sm" intent="success" disabled={pending} onClick={() => resolve("approve")}>
              Approve
            </Button>
            <Button size="sm" intent="danger-outline" disabled={pending} onClick={() => setDenying(true)}>
              Deny…
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" intent="danger" disabled={pending || !reason.trim()} onClick={() => resolve("deny")}>
              Deny request
            </Button>
            <Button size="sm" intent="outline" disabled={pending} onClick={() => setDenying(false)}>
              Back
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
  );
}
