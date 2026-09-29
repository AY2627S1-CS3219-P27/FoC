"use client";

import Link from "next/link";
import { useState } from "react";

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
    <main className="flex flex-1 items-center justify-center p-6 bg-background">
      <div className="w-full max-w-md fade-in">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-nus-blue mb-4 shadow-lg">
            <span className="text-2xl font-bold text-white tracking-tight">FoC</span>
          </div>
          <h1 className="text-3xl font-bold text-foreground">Reset password</h1>
          <p className="text-muted mt-1">
            {sent
              ? "Check your email for a reset link."
              : "Enter your email to receive a reset link."}
          </p>
        </div>

        {!sent ? (
          <form
            onSubmit={onSubmit}
            className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-6 shadow-sm"
          >
            <div>
              <label className="block text-sm font-medium mb-1.5">Email</label>
              <input
                name="email"
                type="email"
                placeholder="e0123456@u.nus.edu"
                required
                autoComplete="email"
                className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm transition-shadow"
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-danger fade-in">
                {error}
              </p>
            )}
            <button
              disabled={pending}
              className="btn-press w-full rounded-xl bg-nus-orange px-4 py-2.5 text-sm font-semibold text-white hover:bg-nus-orange-hover disabled:opacity-50 transition-colors"
            >
              {pending ? "Sending…" : "Send reset link"}
            </button>
            <Link
              href="/login"
              className="text-sm text-center text-nus-blue hover:underline"
            >
              Back to sign in
            </Link>
          </form>
        ) : (
          <div className="rounded-2xl border border-border bg-surface p-6 text-center shadow-sm fade-in">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-nus-orange/10 mb-4">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--nus-orange)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="4" width="20" height="16" rx="2"/>
                <path d="M22 4L12 13 2 4"/>
              </svg>
            </div>
            <p className="text-sm text-muted mb-4">
              If an account exists with that email, a password reset link has
              been sent. Check your inbox (and spam folder).
            </p>
            <Link
              href="/login"
              className="btn-press inline-block rounded-xl bg-nus-blue px-4 py-2 text-sm font-semibold text-white hover:bg-nus-blue-light transition-colors"
            >
              Return to sign in
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
