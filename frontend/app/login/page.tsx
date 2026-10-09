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
      setError(res.status === 401 ? "Invalid email or password." : "Login failed.");
    } catch {
      setError("Could not reach the server.");
    }
    setPending(false);
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <form onSubmit={onSubmit} className="flex w-full max-w-sm flex-col gap-4">
        <h1 className="text-2xl font-semibold">Log in to FoC</h1>
        <input
          name="email"
          type="email"
          placeholder="Email"
          required
          autoComplete="email"
          className="rounded border border-zinc-300 p-2 dark:border-zinc-700 dark:bg-black"
        />
        <input
          name="password"
          type="password"
          placeholder="Password"
          required
          minLength={12}
          autoComplete="current-password"
          className="rounded border border-zinc-300 p-2 dark:border-zinc-700 dark:bg-black"
        />
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <button
          disabled={pending}
          className="rounded bg-foreground p-2 text-background disabled:opacity-50"
        >
          {pending ? "Logging in…" : "Log in"}
        </button>
        <Link href="/register" className="text-sm underline">No account? Register</Link>
      </form>
    </main>
  );
}
