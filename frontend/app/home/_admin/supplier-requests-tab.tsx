"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

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
      { quiet: true },
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
      return u ? `${u.displayName} (${u.email})` : id.slice(0, 8);
    },
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold mb-1">Supplier requests</h2>
          <p className="text-muted text-sm">
            {total} pending request{total !== 1 ? "s" : ""} from students.
          </p>
        </div>
        <select
          value={type}
          onChange={(e) => {
            setLoading(true);
            setType(e.target.value as "" | RequestType);
          }}
          className="rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm"
        >
          <option value="">All types</option>
          {(Object.keys(TYPE_LABELS) as RequestType[]).map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <p className="text-center py-12 text-muted">Loading requests…</p>
      ) : error ? (
        <p role="alert" className="text-center py-12 text-danger text-sm">
          {error}
        </p>
      ) : items.length === 0 ? (
        <p className="text-center py-12 text-muted">No pending requests.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
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
    api<Record<string, unknown>>("GET", `/api/suppliers/${request.supplierId}`, { quiet: true }).then(
      (res) => setDetail(res.data),
    );
  }, [request.supplierId]);

  function show(key: string, value: unknown): string {
    if (value === null || value === undefined || value === "") return "—";
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
    if (res.ok) onDone();
    else setError(`${res.status} ${res.message ?? res.code ?? `Could not ${action}.`}`);
  }

  const showCurrent = request.type !== "Create" && !!(detail ?? supplier);

  return (
    <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h3 className="font-semibold">
          {request.type === "Create"
            ? show("name", request.values.name)
            : String(detail?.displayName ?? supplier?.displayName ?? `Supplier ${request.supplierId?.slice(0, 8)}`)}
        </h3>
        <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-nus-blue/10 text-nus-blue whitespace-nowrap">
          {TYPE_LABELS[request.type]}
        </span>
      </div>
      <p className="text-xs text-muted mb-4">
        By {label.user(request.submittedBy)} · {new Date(request.submittedAt).toLocaleString()}
        {request.supplierVersion !== null && ` · against version ${request.supplierVersion}`}
      </p>

      <table className="w-full text-sm mb-4">
        <thead>
          <tr className="text-left text-muted">
            <th className="py-1 pr-3 font-medium">Field</th>
            {showCurrent && <th className="py-1 pr-3 font-medium">Current</th>}
            <th className="py-1 font-medium">{request.type === "Create" ? "Value" : "Requested"}</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(request.values).map(([key, value]) => (
            <tr key={key} className="border-t border-border align-top">
              <td className="py-1.5 pr-3 text-muted">{key}</td>
              {showCurrent && <td className="py-1.5 pr-3">{show(key, current(key))}</td>}
              <td className="py-1.5 font-medium break-words">{show(key, value)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {denying && (
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          rows={2}
          placeholder="Reason for denying (required)"
          className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm mb-3"
        />
      )}

      <div className="flex flex-wrap gap-2">
        {!denying ? (
          <>
            <button
              disabled={pending}
              onClick={() => resolve("approve")}
              className="btn-press rounded-xl bg-success px-3.5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              Approve
            </button>
            <button
              disabled={pending}
              onClick={() => setDenying(true)}
              className="btn-press rounded-xl border border-danger px-3.5 py-2 text-sm font-semibold text-danger hover:bg-danger/10 disabled:opacity-50"
            >
              Deny…
            </button>
          </>
        ) : (
          <>
            <button
              disabled={pending || !reason.trim()}
              onClick={() => resolve("deny")}
              className="btn-press rounded-xl bg-danger px-3.5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              Deny request
            </button>
            <button
              disabled={pending}
              onClick={() => setDenying(false)}
              className="btn-press rounded-xl border border-border px-3.5 py-2 text-sm text-muted hover:text-foreground"
            >
              Back
            </button>
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger mt-2">
          {error}
        </p>
      )}
    </div>
  );
}
