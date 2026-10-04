"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthShell, ErrorNote, Field, SubmitButton } from "../_components/auth-shell";

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
      setError(res.status === 401 ? "That email and password don't match." : "Something went wrong. Try again?");
    } catch {
      setError("We couldn't reach the server. Check your connection.");
    }
    setPending(false);
  }

  return (
    <AuthShell>
      <h1 className="font-display text-4xl font-extrabold tracking-tight">Welcome back</h1>
      <p className="mt-2 text-muted">Log in to see what errands are happening around campus.</p>
      <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-4">
        <Field label="Email" name="email" type="email" placeholder="you@u.nus.edu" required autoComplete="email" />
        <Field label="Password" name="password" type="password" required minLength={12} autoComplete="current-password" />
        <ErrorNote message={error} />
        <SubmitButton pending={pending}>{pending ? "Logging in…" : "Log in"}</SubmitButton>
      </form>
      <p className="mt-6 text-sm text-muted">
        New here?{" "}
        <Link href="/register" className="font-semibold text-accent underline-offset-4 hover:underline">
          Create an account
        </Link>
      </p>
    </AuthShell>
  );
}
