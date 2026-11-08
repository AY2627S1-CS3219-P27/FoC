"use client";

import { useState } from "react";
import { toast } from "sonner";
import { api, errorText } from "@/lib/api";
import { FormError } from "@/components/ui/field";
import { List, ListRow } from "@/components/ui/layout";

// Admin-only row in a supplier's sheet that switches it between Active and Inactive.
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
    const current = await api("GET", `/api/suppliers/${supplierId}`);
    if (!current.etag) {
      setPending(false);
      setError(errorText(current, "Could not read the supplier's version."));
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
    } else setError(errorText(res, "Could not change the status."));
  }

  return (
    <section>
      <h2 className="section-label mb-1.5 px-4">Admin</h2>
      <List>
        <ListRow
          title={pending ? "Saving…" : next === "Inactive" ? "Deactivate supplier" : "Activate supplier"}
          tone={next === "Inactive" ? "danger" : "tint"}
          chevron={false}
          onClick={pending ? undefined : () => void change()}
        />
      </List>
      <p className="mt-1.5 px-4 text-[13px] text-muted">
        {status === "Active"
          ? "Deactivating hides it from new errands. Existing errands keep their pickup."
          : "Activating lets requesters pick it again."}
      </p>
      {error && (
        <div className="mt-2 px-4">
          <FormError>{error}</FormError>
        </div>
      )}
    </section>
  );
}
