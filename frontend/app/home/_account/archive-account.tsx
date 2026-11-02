"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormError } from "@/components/ui/field";

export function ArchiveAccount() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function archive() {
    setPending(true);
    setError("");
    const res = await api("POST", "/api/users/me/archive");
    setPending(false);
    if (res.ok) router.push("/login");
    else {
      setConfirming(false);
      setError(`${res.status} ${res.message ?? res.code ?? "Could not archive your account."}`);
    }
  }

  return (
    <section className="rounded-2xl border border-danger/30 bg-danger/[0.03] p-5 sm:p-6">
      <h2 className="text-lg font-semibold text-danger">Archive account</h2>
      <p className="mt-1 mb-4 text-sm text-muted">
        Archiving signs you out and deactivates your account. An admin can restore it later.
      </p>
      <Button intent="danger-outline" size="sm" onClick={() => setConfirming(true)}>
        Archive my account
      </Button>
      {error && (
        <div className="mt-3">
          <FormError>{error}</FormError>
        </div>
      )}
      <ConfirmDialog
        open={confirming}
        onOpenChange={(open) => !pending && setConfirming(open)}
        title="Archive your account?"
        description="You will be signed out straight away. Only an admin can restore the account."
        confirmLabel="Yes, archive it"
        intent="danger"
        pending={pending}
        onConfirm={() => void archive()}
      />
    </section>
  );
}
