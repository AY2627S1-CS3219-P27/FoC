"use client";

import { useState } from "react";
import { api, errorText } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Field, FormError, inputClass } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";

export function CreateUserForm<U>({ onCreated, onCancel }: { onCreated: (user: U) => void; onCancel?: () => void }) {
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
    else setError(errorText(res, "Could not create the user."));
  }

  const toggle = (r: string) => setRoles((rs) => (rs.includes(r) ? rs.filter((x) => x !== r) : [...rs, r]));

  return (
    <form onSubmit={submit} className="space-y-5">
      <div>
        <div className="space-y-4 rounded-2xl bg-surface p-4">
          <Field label="Email">
            <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={`w-full ${inputClass}`} />
          </Field>
          <Field label="Display name">
            <input required maxLength={255} value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={`w-full ${inputClass}`} />
          </Field>
        </div>
        <p className="mt-1.5 px-4 text-[13px] text-muted">
          The account starts without a password. They set one with &ldquo;Forgot password&rdquo; on the sign-in page.
        </p>
      </div>

      <section>
        <h2 className="section-label mb-1.5 px-4">Access</h2>
        <ul className="overflow-hidden rounded-2xl bg-surface [&>li+li>div]:border-t">
          {(
            [
              ["requester", "Requester", roles.includes("requester"), () => toggle("requester")],
              ["courier", "Courier", roles.includes("courier"), () => toggle("courier")],
              ["admin", "Admin", isAdmin, () => setIsAdmin((a) => !a)],
            ] as const
          ).map(([key, label, on, flip]) => (
            <li key={key} className="pl-4">
              <div className="flex items-center justify-between border-border py-2 pr-4">
                <span className="text-[15px]">{label}</span>
                <Switch label={label} checked={on} onCheckedChange={flip} />
              </div>
            </li>
          ))}
        </ul>
      </section>

      {error && <FormError>{error}</FormError>}
      <div className="grid gap-2">
        <Button type="submit" size="lg" block disabled={pending}>
          {pending ? "Creating…" : "Create user"}
        </Button>
        {onCancel && (
          <Button intent="ghost" size="lg" block onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
