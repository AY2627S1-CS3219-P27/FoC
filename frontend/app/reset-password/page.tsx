"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AuthCard, AuthShell } from "@/components/auth-shell";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FormError, inputClass } from "@/components/ui/field";
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
      <div className="fade-in rounded-2xl border border-border bg-surface p-6 text-center shadow-card">
        <p className="text-muted">
          No reset token found. Please use the link from your email.
        </p>
        <Link
          href="/forgot-password"
          className="mt-4 inline-block text-sm text-nus-blue underline-offset-4 hover:underline"
        >
          Request a new reset link
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="fade-in rounded-2xl border border-border bg-surface p-6 text-center shadow-card">
        <div className="mb-4 inline-flex size-14 items-center justify-center rounded-full bg-success/10 text-success">
          <CheckIcon size={26} />
        </div>
        <p className="mb-1 font-semibold">Password reset successfully</p>
        <p className="mb-5 text-sm text-muted">
          You can now sign in with your new password.
        </p>
        <Link href="/login" className={buttonVariants()}>
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <AuthCard onSubmit={onSubmit}>
      <Field label="New password">
        <input
          name="password"
          type="password"
          placeholder="At least 12 characters"
          required
          minLength={12}
          maxLength={255}
          autoComplete="new-password"
          className={`w-full ${inputClass}`}
        />
      </Field>
      <Field label="Confirm password">
        <input
          name="confirm"
          type="password"
          placeholder="Re-enter your password"
          required
          minLength={12}
          maxLength={255}
          autoComplete="new-password"
          className={`w-full ${inputClass}`}
        />
      </Field>
      {error && <FormError>{error}</FormError>}
      <Button type="submit" size="lg" block disabled={pending}>
        {pending ? "Resetting…" : "Set new password"}
      </Button>
    </AuthCard>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthShell title="Set new password">
      <Suspense fallback={<div className="text-center text-muted">Loading…</div>}>
        <ResetForm />
      </Suspense>
    </AuthShell>
  );
}
