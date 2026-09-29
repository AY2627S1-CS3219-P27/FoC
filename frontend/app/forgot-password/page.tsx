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
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-nus-blue mb-4">
            <span className="text-2xl font-bold text-white">FoC</span>
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
            className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-6"
          >
            <div>
              <label className="block text-sm font-medium mb-1">Email</label>
              <input
                name="email"
                type="email"
                placeholder="e0123456@u.nus.edu"
                required
                autoComplete="email"
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-nus-orange"
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
            <button
              disabled={pending}
              className="w-full rounded-lg bg-nus-orange px-4 py-2.5 text-sm font-semibold text-white hover:bg-nus-orange-hover disabled:opacity-50 transition-colors"
            >
              {pending ? "Sending..." : "Send reset link"}
            </button>
            <Link
              href="/login"
              className="text-sm text-center text-nus-blue hover:underline"
            >
              Back to sign in
            </Link>
          </form>
        ) : (
          <div className="rounded-xl border border-border bg-surface p-6 text-center">
            <div className="text-4xl mb-4">📧</div>
            <p className="text-sm text-muted mb-4">
              If an account exists with that email, a password reset link has
              been sent. Check your inbox (and spam folder).
            </p>
            <Link
              href="/login"
              className="inline-block rounded-lg bg-nus-blue px-4 py-2 text-sm font-semibold text-white hover:bg-nus-blue-light"
            >
              Return to sign in
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
