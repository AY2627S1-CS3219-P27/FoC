"use client";

import { useState } from "react";
import { api } from "@/lib/api";

export function CreateUserForm<U>({ onCreated, onCancel }: { onCreated: (user: U) => void; onCancel: () => void }) {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [roles, setRoles] = useState<string[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError("");
    const res = await api<U>("POST", "/api/users", {
      body: { email: email.trim(), displayName: displayName.trim(), roles, isAdmin },
    });
    setPending(false);
    if (res.ok && res.data) onCreated(res.data);
    else setError(`${res.status} ${res.message ?? res.code ?? "Could not create the user."}`);
  }

  const toggle = (r: string) => setRoles((rs) => (rs.includes(r) ? rs.filter((x) => x !== r) : [...rs, r]));
  const input = "w-full rounded-xl border border-border bg-background px-3 py-2 text-sm";

  return (
    <form onSubmit={submit} className="rounded-2xl border border-border bg-surface p-4 mb-6 space-y-3 max-w-xl">
      <div>
        <h3 className="font-semibold">Create user</h3>
        <p className="text-xs text-muted">
          The account gets no usable password. The user sets one with &ldquo;Forgot password&rdquo; on the login page.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="block mb-1 font-medium">Email</span>
          <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={input} />
        </label>
        <label className="block text-sm">
          <span className="block mb-1 font-medium">Display name</span>
          <input required maxLength={255} value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={input} />
        </label>
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        {["requester", "courier"].map((r) => (
          <label key={r} className="flex items-center gap-1.5 capitalize">
            <input type="checkbox" checked={roles.includes(r)} onChange={() => toggle(r)} />
            {r}
          </label>
        ))}
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} />
          Admin
        </label>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          disabled={pending}
          className="btn-press rounded-xl bg-nus-orange px-3.5 py-2 text-sm font-semibold text-white hover:bg-nus-orange-hover disabled:opacity-50"
        >
          {pending ? "Creating…" : "Create user"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="btn-press rounded-xl border border-border px-3.5 py-2 text-sm text-muted hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
