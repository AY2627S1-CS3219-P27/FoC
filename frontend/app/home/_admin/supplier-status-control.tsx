"use client";

import { useState } from "react";
import { api } from "@/lib/api";

export function SupplierStatusControl({
  supplierId,
  status,
  onChanged,
}: {
  supplierId: string;
  status: string;
  onChanged: (status: string) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const next = status === "Active" ? "Inactive" : "Active";

  async function change() {
    setPending(true);
    setError("");
    // The status change needs the current version in If-Match, which the detail read returns as its ETag.
    const current = await api("GET", `/api/suppliers/${supplierId}`, { quiet: true });
    if (!current.etag) {
      setPending(false);
      setError(`${current.status} ${current.message ?? "Could not read the supplier's version."}`);
      return;
    }
    const res = await api<{ status: string }>("PUT", `/api/suppliers/${supplierId}/status`, {
      body: { status: next },
      ifMatch: current.etag,
    });
    setPending(false);
    if (res.ok && res.data) onChanged(res.data.status);
    else setError(`${res.status} ${res.message ?? res.code ?? "Could not change the status."}`);
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-sm font-medium mb-1">Admin</p>
      <p className="text-xs text-muted mb-3">
        {status === "Active"
          ? "Deactivating hides it from new errands. Existing errands keep their pickup."
          : "Activating lets requesters pick it again."}
      </p>
      <button
        disabled={pending}
        onClick={change}
        className={`btn-press rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${
          next === "Inactive"
            ? "border border-danger text-danger hover:bg-danger/10"
            : "bg-success text-white hover:opacity-90"
        }`}
      >
        {pending ? "Saving…" : next === "Inactive" ? "Deactivate supplier" : "Activate supplier"}
      </button>
      {error && (
        <p role="alert" className="text-sm text-danger mt-2">
          {error}
        </p>
      )}
    </div>
  );
}
