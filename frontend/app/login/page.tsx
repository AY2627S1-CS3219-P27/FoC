"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setPending(true);
    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.get("email"),
          password: form.get("password"),
        }),
      });
      if (res.ok) return router.push("/home");
      setError(
        res.status === 401 ? "Invalid email or password." : "Login failed."
      );
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
          <h1 className="text-3xl font-bold text-foreground">Welcome back</h1>
          <p className="text-muted mt-1">
            Sign in to Friend on Campus
          </p>
        </div>

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
          <div>
            <label className="block text-sm font-medium mb-1.5">Password</label>
            <input
              name="password"
              type="password"
              placeholder="Enter your password"
              required
              minLength={12}
              autoComplete="current-password"
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
            {pending ? "Signing in…" : "Sign in"}
          </button>

          <div className="flex items-center justify-between text-sm">
            <Link
              href="/forgot-password"
              className="text-nus-blue hover:underline"
            >
              Forgot password?
            </Link>
            <Link href="/register" className="text-nus-blue hover:underline">
              Create account
            </Link>
          </div>
        </form>
      </div>
    </main>
  );
}
