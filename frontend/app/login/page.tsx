"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthCard, AuthShell } from "@/components/auth-shell";
import { Button } from "@/components/ui/button";
import { Field, FormError, inputClass } from "@/components/ui/field";

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
    <AuthShell title="Welcome back" subtitle="Sign in to Friend on Campus">
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
        <Field label="Password">
          <input
            name="password"
            type="password"
            placeholder="Enter your password"
            required
            minLength={12}
            autoComplete="current-password"
            className={`w-full ${inputClass}`}
          />
        </Field>

        {error && <FormError>{error}</FormError>}

        <Button type="submit" size="lg" block disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </Button>

        <div className="flex items-center justify-between text-sm">
          <Link href="/forgot-password" className="text-nus-blue-ink underline-offset-4 hover:underline">
            Forgot password?
          </Link>
          <Link href="/register" className="text-nus-blue-ink underline-offset-4 hover:underline">
            Create account
          </Link>
        </div>
      </AuthCard>
    </AuthShell>
  );
}
