"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";

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
    else setError(`${res.status} ${res.message ?? res.code ?? "Could not archive your account."}`);
  }

  return (
    <div className="rounded-2xl border border-danger/40 bg-surface p-6 mt-6 shadow-sm">
      <h3 className="text-lg font-semibold mb-2 text-danger">Archive account</h3>
      <p className="text-sm text-muted mb-4">
        Archiving signs you out and deactivates your account. An admin can restore it later.
      </p>
      {!confirming ? (
        <button
          onClick={() => setConfirming(true)}
          className="btn-press rounded-xl border border-danger px-4 py-2 text-sm font-semibold text-danger hover:bg-danger/10"
        >
          Archive my account
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">Are you sure?</span>
          <button
            disabled={pending}
            onClick={archive}
            className="btn-press rounded-xl bg-danger px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Archiving…" : "Yes, archive it"}
          </button>
          <button
            disabled={pending}
            onClick={() => setConfirming(false)}
            className="btn-press rounded-xl border border-border px-4 py-2 text-sm text-muted hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger mt-2">
          {error}
        </p>
      )}
    </div>
  );
}
