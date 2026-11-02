"use client";

import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";

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
    if (res.ok && res.data) {
      toast.success(res.data.status === "Active" ? "Supplier activated" : "Supplier deactivated");
      onChanged(res.data.status);
    } else setError(`${res.status} ${res.message ?? res.code ?? "Could not change the status."}`);
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <p className="text-sm font-semibold">Admin</p>
      <p className="mt-0.5 mb-3 text-xs text-muted">
        {status === "Active"
          ? "Deactivating hides it from new errands. Existing errands keep their pickup."
          : "Activating lets requesters pick it again."}
      </p>
      <Button
        size="sm"
        disabled={pending}
        onClick={change}
        intent={next === "Inactive" ? "danger-outline" : "success"}
      >
        {pending ? "Saving…" : next === "Inactive" ? "Deactivate supplier" : "Activate supplier"}
      </Button>
      {error && (
        <div className="mt-2">
          <FormError>{error}</FormError>
        </div>
      )}
    </div>
  );
}
