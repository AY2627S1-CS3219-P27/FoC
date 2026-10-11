"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Step = "email" | "otp" | "details";

const steps: { key: Step; label: string }[] = [
  { key: "email", label: "Email" },
  { key: "otp", label: "Verify" },
  { key: "details", label: "Account" },
];

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

  const stepIndex = steps.findIndex((s) => s.key === step);

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
        } else setError("Could not send OTP. Use an @u.nus.edu email.");
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
              : "Registration failed."
        );
      }
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
          <h1 className="text-3xl font-bold text-foreground">
            Create your account
          </h1>
          <p className="text-muted mt-1">Join Friend on Campus</p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2 mb-6">
          {steps.map((s, i) => (
            <div key={s.key} className="flex items-center gap-2">
              <div
                className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-semibold transition-colors ${
                  i <= stepIndex
                    ? "bg-nus-orange text-white"
                    : "bg-border text-muted"
                }`}
              >
                {i < stepIndex ? (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M2.5 7l3 3 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                ) : (
                  i + 1
                )}
              </div>
              <span
                className={`text-sm ${i <= stepIndex ? "text-foreground font-medium" : "text-muted"}`}
              >
                {s.label}
              </span>
              {i < steps.length - 1 && (
                <div
                  className={`w-8 h-0.5 rounded-full transition-colors ${i < stepIndex ? "bg-nus-orange" : "bg-border"}`}
                />
              )}
            </div>
          ))}
        </div>

        <form
          key={step}
          onSubmit={onSubmit}
          className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-6 shadow-sm fade-in"
        >
          {step === "email" && (
            <div>
              <label className="block text-sm font-medium mb-1.5">
                NUS Email
              </label>
              <input
                name="email"
                type="email"
                placeholder="e0123456@u.nus.edu"
                required
                autoComplete="email"
                className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm transition-shadow"
              />
              <p className="text-xs text-muted mt-1.5">
                Only @u.nus.edu addresses are accepted.
              </p>
            </div>
          )}

          {step === "otp" && (
            <div>
              <p className="text-sm text-muted mb-3">
                Enter the 6-character code sent to{" "}
                <span className="font-medium text-foreground">{email}</span>.
              </p>
              <label className="block text-sm font-medium mb-1.5">
                Verification code
              </label>
              <input
                name="otp"
                placeholder="Enter 6-character code"
                required
                minLength={6}
                maxLength={6}
                autoComplete="one-time-code"
                className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm tracking-widest text-center font-mono transition-shadow"
              />
            </div>
          )}

          {step === "details" && (
            <>
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Display name
                </label>
                <input
                  name="displayName"
                  placeholder="How others will see you"
                  required
                  maxLength={255}
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm transition-shadow"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Password
                </label>
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
            </>
          )}

          {error && (
            <p role="alert" className="text-sm text-danger fade-in">
              {error}
            </p>
          )}

          <button
            disabled={pending}
            className="btn-press w-full rounded-xl bg-nus-orange px-4 py-2.5 text-sm font-semibold text-white hover:bg-nus-orange-hover disabled:opacity-50 transition-colors"
          >
            {pending
              ? "Please wait…"
              : step === "details"
                ? "Create account"
                : "Continue"}
          </button>

          <Link
            href="/login"
            className="text-sm text-center text-nus-blue hover:underline"
          >
            Already have an account? Sign in
          </Link>
        </form>
      </div>
    </main>
  );
}
