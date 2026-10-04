"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthShell, ErrorNote, Field, SubmitButton } from "../_components/auth-shell";

type Step = "email" | "otp" | "details";

const steps: Record<Step, { n: number; title: string; blurb: string }> = {
  email: { n: 1, title: "Join FoC", blurb: "Start with your email. We'll send you a code to confirm it's you." },
  otp: { n: 2, title: "Check your inbox", blurb: "" },
  details: { n: 3, title: "Almost there", blurb: "Pick the name other students will see, and a password." },
};

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
        } else setError("We couldn't send a code to that email.");
      } else if (step === "otp") {
        const res = await post("/api/otp/validate", {
          email,
          otp: form.get("otp"),
        });
        if (res.ok) setStep("details");
        else setError("That code doesn't look right. Try again?");
      } else {
        const res = await post("/api/auth/register", {
          displayName: form.get("displayName"),
          password: form.get("password"),
        });
        if (res.ok) return router.push("/login");
        setError(
          res.status === 409
            ? "That email already has an account. Try logging in."
            : res.status === 401
              ? "This sign-up timed out. Please start again."
              : "Something went wrong. Try again?",
        );
      }
    } catch {
      setError("We couldn't reach the server. Check your connection.");
    }
    setPending(false);
  }

  const { n, title, blurb } = steps[step];

  return (
    <AuthShell>
      <div className="mb-6 flex items-center gap-2" aria-label={`Step ${n} of 3`}>
        {[1, 2, 3].map((i) => (
          <span key={i} className={`h-1.5 w-8 rounded-full ${i <= n ? "bg-accent" : "bg-line"}`} />
        ))}
        <span className="ml-2 text-xs font-semibold text-muted">Step {n} of 3</span>
      </div>
      <h1 className="font-display text-4xl font-extrabold tracking-tight">{title}</h1>
      <p className="mt-2 text-muted">
        {step === "otp" ? (
          <>We sent a 6-character code to <span className="font-semibold text-ink">{email}</span>.</>
        ) : (
          blurb
        )}
      </p>
      <form key={step} onSubmit={onSubmit} className="mt-8 flex flex-col gap-4">
        {step === "email" && (
          <Field label="Email" name="email" type="email" placeholder="you@u.nus.edu" required autoComplete="email" autoFocus />
        )}
        {step === "otp" && (
          <Field
            label="Verification code"
            name="otp"
            required
            minLength={6}
            maxLength={6}
            autoComplete="one-time-code"
            autoFocus
          />
        )}
        {step === "details" && (
          <>
            <Field label="Display name" name="displayName" placeholder="e.g. Jia Hui" required maxLength={255} autoFocus />
            <Field
              label="Password"
              name="password"
              type="password"
              hint="At least 12 characters."
              required
              minLength={12}
              maxLength={255}
              autoComplete="new-password"
            />
          </>
        )}
        <ErrorNote message={error} />
        <SubmitButton pending={pending}>
          {pending ? "One sec…" : step === "details" ? "Create account" : "Continue"}
        </SubmitButton>
      </form>
      <p className="mt-6 text-sm text-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-accent underline-offset-4 hover:underline">
          Log in
        </Link>
      </p>
    </AuthShell>
  );
}
