"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Step = "email" | "otp" | "details";

const input =
  "rounded border border-zinc-300 p-2 dark:border-zinc-700 dark:bg-black";

async function post(path: string, body: object) {
  return fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export default function RegisterPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setPending(true);
    const form = new FormData(e.currentTarget);
    try {
      if (step === "email") {
        const value = String(form.get("email"));
        const res = await post("/api/otp", { email: value });
        if (res.ok) {
          setEmail(value);
          setStep("otp");
        } else setError("Could not send OTP.");
      } else if (step === "otp") {
        const res = await post("/api/otp/validate", {
          email,
          otp: form.get("otp"),
        });
        if (res.ok) setStep("details");
        else setError("Invalid OTP.");
      } else {
        const res = await post("/api/auth/register", {
          displayName: form.get("displayName"),
          password: form.get("password"),
        });
        if (res.ok) return router.push("/login");
        setError(
          res.status === 409
            ? "Email is already registered."
            : res.status === 401
              ? "Registration expired. Start again."
              : "Registration failed.",
        );
      }
    } catch {
      setError("Could not reach the server.");
    }
    setPending(false);
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <form
        key={step}
        onSubmit={onSubmit}
        className="flex w-full max-w-sm flex-col gap-4"
      >
        <h1 className="text-2xl font-semibold">Register for FoC</h1>
        {step === "email" && (
          <input name="email" type="email" placeholder="Email" required autoComplete="email" className={input} />
        )}
        {step === "otp" && (
          <>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">Enter the 6-character code sent to {email}.</p>
            <input name="otp" placeholder="OTP" required minLength={6} maxLength={6} autoComplete="one-time-code" className={input} />
          </>
        )}
        {step === "details" && (
          <>
            <input name="displayName" placeholder="Display name" required maxLength={255} className={input} />
            <input name="password" type="password" placeholder="Password (min 12 characters)" required minLength={12} maxLength={255} autoComplete="new-password" className={input} />
          </>
        )}
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <button disabled={pending} className="rounded bg-foreground p-2 text-background disabled:opacity-50">
          {pending ? "Please wait…" : step === "details" ? "Register" : "Continue"}
        </button>
        <Link href="/login" className="text-sm underline">Already have an account? Log in</Link>
      </form>
    </main>
  );
}
