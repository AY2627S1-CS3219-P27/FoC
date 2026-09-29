"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

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
      <div className="rounded-2xl border border-border bg-surface p-6 text-center shadow-sm fade-in">
        <p className="text-muted">
          No reset token found. Please use the link from your email.
        </p>
        <Link
          href="/forgot-password"
          className="inline-block mt-4 text-sm text-nus-blue hover:underline"
        >
          Request a new reset link
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-6 text-center shadow-sm fade-in">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-success/10 mb-4">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12l5 5L20 7"/>
          </svg>
        </div>
        <p className="font-semibold mb-2">Password reset successfully</p>
        <p className="text-sm text-muted mb-4">
          You can now sign in with your new password.
        </p>
        <Link
          href="/login"
          className="btn-press inline-block rounded-xl bg-nus-orange px-4 py-2 text-sm font-semibold text-white hover:bg-nus-orange-hover transition-colors"
        >
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-6 shadow-sm"
    >
      <div>
        <label className="block text-sm font-medium mb-1.5">New password</label>
        <input
          name="password"
          type="password"
          placeholder="At least 12 characters"
          required
          minLength={12}
          maxLength={255}
          autoComplete="new-password"
          className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm transition-shadow"
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1.5">
          Confirm password
        </label>
        <input
          name="confirm"
          type="password"
          placeholder="Re-enter your password"
          required
          minLength={12}
          maxLength={255}
          autoComplete="new-password"
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
        {pending ? "Resetting…" : "Set new password"}
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-6 bg-background">
      <div className="w-full max-w-md fade-in">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-nus-blue mb-4 shadow-lg">
            <span className="text-2xl font-bold text-white tracking-tight">FoC</span>
          </div>
          <h1 className="text-3xl font-bold text-foreground">
            Set new password
          </h1>
        </div>
        <Suspense
          fallback={<div className="text-center text-muted">Loading...</div>}
        >
          <ResetForm />
        </Suspense>
      </div>
    </main>
  );
}
