"use client";

import { clsx } from "clsx";
import { OTPInput, type SlotProps } from "input-otp";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthCard, AuthShell } from "@/components/auth-shell";
import { Button } from "@/components/ui/button";
import { Field, FormError, inputClass } from "@/components/ui/field";
import { CheckIcon } from "@/components/ui/icons";

type Step = "email" | "otp" | "details";

const steps: { key: Step; label: string }[] = [
  { key: "email", label: "Email" },
  { key: "otp", label: "Verify" },
  { key: "details", label: "Account" },
];

const OTP_LENGTH = 6;
// The code is base64url, so letters (case-sensitive), digits, "-" and "_".
const OTP_PATTERN = "^[A-Za-z0-9_-]+$";

async function post(path: string, body: object) {
  return fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function OtpSlot({ char, isActive, hasFakeCaret }: SlotProps) {
  return (
    <div
      className={clsx(
        "relative flex h-12 min-w-0 flex-1 items-center justify-center rounded-xl border bg-background font-mono text-lg font-semibold transition-[border-color,box-shadow] duration-150 sm:h-14",
        isActive ? "border-nus-orange shadow-[0_0_0_3px_rgba(239,124,0,0.3)]" : "border-border",
      )}
    >
      {char}
      {hasFakeCaret && (
        <span aria-hidden="true" className="absolute h-5 w-px animate-pulse bg-foreground motion-reduce:animate-none" />
      )}
    </div>
  );
}

export default function RegisterPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
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
        const res = await post("/api/otp/validate", { email, otp });
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
    <AuthShell title="Create your account" subtitle="Join Friend on Campus">
      <ol className="mb-6 flex items-center justify-center gap-2" aria-label="Sign-up progress">
        {steps.map((s, i) => (
          <li key={s.key} className="flex items-center gap-2" aria-current={i === stepIndex ? "step" : undefined}>
            <span
              className={clsx(
                "flex size-7 items-center justify-center rounded-full text-xs font-semibold transition-colors duration-200",
                i <= stepIndex ? "bg-nus-orange text-white" : "bg-border text-muted",
              )}
            >
              {i < stepIndex ? <CheckIcon size={14} /> : i + 1}
            </span>
            <span className={clsx("text-sm", i <= stepIndex ? "font-medium text-foreground" : "text-muted")}>
              {s.label}
            </span>
            {i < steps.length - 1 && (
              <span
                aria-hidden="true"
                className={clsx(
                  "h-0.5 w-6 rounded-full transition-colors duration-200 sm:w-8",
                  i < stepIndex ? "bg-nus-orange" : "bg-border",
                )}
              />
            )}
          </li>
        ))}
      </ol>

      <AuthCard key={step} onSubmit={onSubmit} className="fade-in">
        {step === "email" && (
          <Field label="NUS email" hint="Only @u.nus.edu addresses are accepted.">
            <input
              name="email"
              type="email"
              placeholder="e0123456@u.nus.edu"
              required
              autoComplete="email"
              className={`w-full ${inputClass}`}
            />
          </Field>
        )}

        {step === "otp" && (
          <div>
            <p className="mb-4 text-sm text-muted">
              Enter the 6-character code sent to{" "}
              <span className="font-medium break-all text-foreground">{email}</span>. It is case-sensitive.
            </p>
            <OTPInput
              autoFocus
              maxLength={OTP_LENGTH}
              pattern={OTP_PATTERN}
              value={otp}
              onChange={setOtp}
              autoComplete="one-time-code"
              aria-label="Verification code"
              containerClassName="flex items-center gap-2"
              render={({ slots }) => slots.map((slot, i) => <OtpSlot key={i} {...slot} />)}
            />
          </div>
        )}

        {step === "details" && (
          <>
            <Field label="Display name">
              <input
                name="displayName"
                placeholder="How others will see you"
                required
                maxLength={255}
                className={`w-full ${inputClass}`}
              />
            </Field>
            <Field label="Password">
              <input
                name="password"
                type="password"
                placeholder="At least 12 characters"
                required
                minLength={12}
                maxLength={255}
                autoComplete="new-password"
                className={`w-full ${inputClass}`}
              />
            </Field>
          </>
        )}

        {error && <FormError>{error}</FormError>}

        <Button
          type="submit"
          size="lg"
          block
          disabled={pending || (step === "otp" && otp.length < OTP_LENGTH)}
        >
          {pending ? "Please wait…" : step === "details" ? "Create account" : "Continue"}
        </Button>

        <Link href="/login" className="text-center text-sm text-nus-blue-ink underline-offset-4 hover:underline">
          Already have an account? Sign in
        </Link>
      </AuthCard>
    </AuthShell>
  );
}
