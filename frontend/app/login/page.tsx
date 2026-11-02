"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AUTH_PLACE, AuthCard, AuthLinks, AuthShell, FieldGroup, authLinkClass, groupInputClass } from "@/components/auth-shell";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";

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
    <AuthShell place={AUTH_PLACE.login} title="Sign in" subtitle="Use your NUS email to sign in to Friend on Campus.">
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
          <input
            name="password"
            type="password"
            aria-label="Password"
            placeholder="Password"
            required
            minLength={12}
            autoComplete="current-password"
            className={groupInputClass}
          />
        </FieldGroup>

        {error && <FormError>{error}</FormError>}

        <Button type="submit" size="lg" block disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </Button>

        <AuthLinks>
          <Link href="/forgot-password" className={authLinkClass}>
            Forgot password?
          </Link>
          <Link href="/register" className={authLinkClass}>
            Create account
          </Link>
        </AuthLinks>
      </AuthCard>
    </AuthShell>
  );
}
