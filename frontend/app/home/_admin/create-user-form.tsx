"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Field, FormError, inputClass } from "@/components/ui/field";

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

  return (
    <form
      onSubmit={submit}
      className="fade-in mb-6 max-w-xl space-y-4 rounded-2xl border border-border bg-surface p-5 shadow-card"
    >
      <div>
        <h2 className="font-semibold">Create user</h2>
        <p className="mt-0.5 text-xs text-muted">
          The account gets no usable password. The user sets one with &ldquo;Forgot password&rdquo; on the login page.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Email">
          <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={`w-full ${inputClass}`} />
        </Field>
        <Field label="Display name">
          <input required maxLength={255} value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={`w-full ${inputClass}`} />
        </Field>
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        {["requester", "courier"].map((r) => (
          <label key={r} className="flex cursor-pointer items-center gap-2 capitalize select-none">
            <input type="checkbox" checked={roles.includes(r)} onChange={() => toggle(r)} className="size-4 accent-nus-orange" />
            {r}
          </label>
        ))}
        <label className="flex cursor-pointer items-center gap-2 select-none">
          <input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} className="size-4 accent-nus-orange" />
          Admin
        </label>
      </div>
      {error && <FormError>{error}</FormError>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Creating…" : "Create user"}
        </Button>
        <Button intent="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
