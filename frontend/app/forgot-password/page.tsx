"use client";

import Link from "next/link";
import { useState } from "react";
import { AUTH_PLACE, AuthCard, AuthLinks, AuthShell, FieldGroup, authLinkClass, groupInputClass } from "@/components/auth-shell";
import { Button, buttonVariants } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";
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
      place={AUTH_PLACE.forgot}
      title="Reset password"
      subtitle={sent ? "Check your email for a reset link." : "Enter your email and we'll send you a reset link."}
    >
      {!sent ? (
        <AuthCard onSubmit={onSubmit}>
          <FieldGroup>
            <input
              name="email"
              type="email"
              aria-label="Email"
              placeholder="Email"
              required
              autoComplete="email"
              className={groupInputClass}
            />
          </FieldGroup>
          {error && <FormError>{error}</FormError>}
          <Button type="submit" size="lg" block disabled={pending}>
            {pending ? "Sending…" : "Send reset link"}
          </Button>
          <AuthLinks>
            <Link href="/login" className={authLinkClass}>
              Back to sign in
            </Link>
          </AuthLinks>
        </AuthCard>
      ) : (
        <div className="fade-in flex flex-col items-center rounded-2xl bg-surface px-6 py-8 text-center shadow-raised">
          <MailIcon size={36} strokeWidth={1.5} className="mb-3 text-nus-orange" />
          <p className="mb-6 text-[15px] text-muted">
            If an account exists with that email, a reset link is on its way. Check your inbox and spam folder.
          </p>
          <Link href="/login" className={buttonVariants({ block: true })}>
            Return to sign in
          </Link>
        </div>
      )}
    </AuthShell>
  );
}
