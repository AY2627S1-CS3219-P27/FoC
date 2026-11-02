"use client";

import Link from "next/link";
import { useState } from "react";
import { AuthCard, AuthShell } from "@/components/auth-shell";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FormError, inputClass } from "@/components/ui/field";
import { MailIcon } from "@/components/ui/icons";

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setPending(true);
    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.get("email") }),
      });
      if (res.ok) setSent(true);
      else setError("Could not process request.");
    } catch {
      setError("Could not reach the server.");
    }
    setPending(false);
  }

  return (
    <AuthShell
      title="Reset password"
      subtitle={sent ? "Check your email for a reset link." : "Enter your email to receive a reset link."}
    >
      {!sent ? (
        <AuthCard onSubmit={onSubmit}>
          <Field label="Email">
            <input
              name="email"
              type="email"
              placeholder="e0123456@u.nus.edu"
              required
              autoComplete="email"
              className={`w-full ${inputClass}`}
            />
          </Field>
          {error && <FormError>{error}</FormError>}
          <Button type="submit" size="lg" block disabled={pending}>
            {pending ? "Sending…" : "Send reset link"}
          </Button>
          <Link href="/login" className="text-center text-sm text-nus-blue-ink underline-offset-4 hover:underline">
            Back to sign in
          </Link>
        </AuthCard>
      ) : (
        <div className="fade-in rounded-2xl border border-border bg-surface p-6 text-center shadow-card">
          <div className="mb-4 inline-flex size-14 items-center justify-center rounded-full bg-nus-orange/10 text-nus-orange">
            <MailIcon size={26} />
          </div>
          <p className="mb-5 text-sm text-muted">
            If an account exists with that email, a password reset link has
            been sent. Check your inbox (and spam folder).
          </p>
          <Link href="/login" className={buttonVariants({ intent: "secondary" })}>
            Return to sign in
          </Link>
        </div>
      )}
    </AuthShell>
  );
}
