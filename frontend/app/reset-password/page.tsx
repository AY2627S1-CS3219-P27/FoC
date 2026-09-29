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
      <div className="rounded-xl border border-border bg-surface p-6 text-center">
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
      <div className="rounded-xl border border-border bg-surface p-6 text-center">
        <div className="text-4xl mb-4">✓</div>
        <p className="font-semibold mb-2">Password reset successfully</p>
        <p className="text-sm text-muted mb-4">
          You can now sign in with your new password.
        </p>
        <Link
          href="/login"
          className="inline-block rounded-lg bg-nus-orange px-4 py-2 text-sm font-semibold text-white hover:bg-nus-orange-hover"
        >
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-6"
    >
      <div>
        <label className="block text-sm font-medium mb-1">New password</label>
        <input
          name="password"
          type="password"
          placeholder="At least 12 characters"
          required
          minLength={12}
          maxLength={255}
          autoComplete="new-password"
          className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-nus-orange"
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">
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
        {pending ? "Resetting..." : "Set new password"}
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-6 bg-background">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-nus-blue mb-4">
            <span className="text-2xl font-bold text-white">FoC</span>
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
