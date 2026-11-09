"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, errorText } from "@/lib/api";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormError } from "@/components/ui/field";
import { List, ListRow } from "@/components/ui/layout";

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
      setError(errorText(res, "Could not archive your account."));
    }
  }

  return (
    <section>
      <List>
        <ListRow
          title={<span className="block text-center">Archive account</span>}
          tone="danger"
          chevron={false}
          onClick={() => setConfirming(true)}
        />
      </List>
      <p className="mt-1.5 px-4 text-[13px] text-muted">
        Archiving signs you out and deactivates your account. An admin can restore it later.
      </p>
      {error && (
        <div className="mt-2 px-4">
          <FormError>{error}</FormError>
        </div>
      )}
      <ConfirmDialog
        open={confirming}
        onOpenChange={(open) => !pending && setConfirming(open)}
        title="Archive your account?"
        description="You'll be signed out straight away. Only an admin can restore the account."
        confirmLabel="Archive"
        intent="danger"
        pending={pending}
        onConfirm={() => void archive()}
      />
    </section>
  );
}
