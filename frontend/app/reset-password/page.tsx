"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AUTH_PLACE, AuthCard, AuthShell, FieldGroup, authLinkClass, groupInputClass } from "@/components/auth-shell";
import { Button, buttonVariants } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";
import { CheckIcon } from "@/components/ui/icons";

function ResetForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setPending(true);
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password"));
    const confirm = String(form.get("confirm"));
    if (password !== confirm) {
      setError("Passwords do not match.");
      setPending(false);
      return;
    }
    try {
      const res = await fetch("/api/password-reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      if (res.ok) setDone(true);
      else setError("Reset failed. The link may have expired.");
    } catch {
      setError("Could not reach the server.");
    }
    setPending(false);
  }

  if (!token) {
    return (
      <div className="fade-in rounded-2xl bg-surface px-6 py-8 text-center shadow-raised">
        <p className="text-[15px] text-muted">No reset token found. Please use the link from your email.</p>
        <Link href="/forgot-password" className={`mt-4 inline-block text-[15px] ${authLinkClass}`}>
          Request a new reset link
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="fade-in flex flex-col items-center rounded-2xl bg-surface px-6 py-8 text-center shadow-raised">
        <CheckIcon size={36} className="mb-3 text-success" />
        <p className="mb-1 text-[17px] font-semibold">Password reset</p>
        <p className="mb-6 text-[15px] text-muted">You can now sign in with your new password.</p>
        <Link href="/login" className={buttonVariants({ block: true })}>
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <AuthCard onSubmit={onSubmit}>
      <FieldGroup>
        <input
          name="password"
          type="password"
          aria-label="New password"
          placeholder="New password (at least 12 characters)"
          required
          minLength={12}
          maxLength={255}
          autoComplete="new-password"
          className={groupInputClass}
        />
        <input
          name="confirm"
          type="password"
          aria-label="Confirm password"
          placeholder="Confirm password"
          required
          minLength={12}
          maxLength={255}
          autoComplete="new-password"
          className={groupInputClass}
        />
      </FieldGroup>
      {error && <FormError>{error}</FormError>}
      <Button type="submit" size="lg" block disabled={pending}>
        {pending ? "Resetting…" : "Set new password"}
      </Button>
    </AuthCard>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthShell place={AUTH_PLACE.reset} title="New password">
      <Suspense fallback={<div className="text-center text-muted">Loading…</div>}>
        <ResetForm />
      </Suspense>
    </AuthShell>
  );
}
