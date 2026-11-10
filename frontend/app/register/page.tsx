"use client";

import { clsx } from "clsx";
import { OTPInput, type SlotProps } from "input-otp";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AUTH_PLACE, AuthCard, AuthLinks, AuthShell, FieldGroup, authLinkClass, groupInputClass } from "@/components/auth-shell";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";
import { pulseNavigation } from "@/lib/nav-pulse";

type Step = "email" | "otp" | "details";

const STEPS: Step[] = ["email", "otp", "details"];

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
        "relative flex h-14 min-w-0 flex-1 items-center justify-center rounded-xl bg-surface font-mono text-xl font-semibold shadow-raised transition-shadow duration-150",
        isActive && "shadow-[0_0_0_2px_var(--nus-orange)]",
      )}
    >
      {char}
      {hasFakeCaret && (
        <span aria-hidden="true" className="absolute h-6 w-0.5 animate-pulse rounded-full bg-nus-orange motion-reduce:animate-none" />
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

  const stepIndex = STEPS.indexOf(step);

  function goTo(next: Step) {
    pulseNavigation(STEPS.indexOf(next) > stepIndex ? "forward" : "back");
    setError("");
    setStep(next);
  }

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
          goTo("otp");
        } else setError("Could not send a code. Use an @u.nus.edu email.");
      } else if (step === "otp") {
        const res = await post("/api/otp/validate", { email, otp });
        if (res.ok) goTo("details");
        else setError("That code didn't work. Check it and try again.");
      } else {
        const password = form.get("password");
        const res = await post("/api/auth/register", {
          displayName: form.get("displayName"),
          password,
        });
        if (res.ok) {
          // Register issues no session, so sign in with the same credentials.
          // If that fails the account still exists; fall back to the login page.
          try {
            const login = await post("/api/auth/login", { email, password });
            return router.push(login.ok ? "/home" : "/login");
          } catch {
            return router.push("/login");
          }
        }
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

  const copy = {
    email: { title: "Create account", subtitle: "Start with your NUS email." },
    otp: { title: "Verify email", subtitle: <>Enter the 6-character code sent to <span className="font-medium break-all text-foreground">{email}</span>. It&rsquo;s case-sensitive.</> },
    details: { title: "Almost there", subtitle: "Choose how others see you, and a password." },
  }[step];

  return (
    <AuthShell place={AUTH_PLACE.register} title={copy.title} subtitle={copy.subtitle}>
      <div aria-label={`Step ${stepIndex + 1} of ${STEPS.length}`} className="mb-5 flex justify-center gap-1.5">
        {STEPS.map((s, i) => (
          <span
            key={s}
            aria-hidden="true"
            className={clsx(
              "h-1.5 rounded-full transition-all duration-300",
              i === stepIndex ? "w-6 bg-nus-orange" : i < stepIndex ? "w-1.5 bg-nus-orange/50" : "w-1.5 bg-muted/30",
            )}
          />
        ))}
      </div>

      <AuthCard key={step} onSubmit={onSubmit} className="push-enter">
        {step === "email" && (
          <FieldGroup>
            <input
              name="email"
              type="email"
              aria-label="NUS email"
              placeholder="e0123456@u.nus.edu"
              required
              autoComplete="email"
              className={groupInputClass}
            />
          </FieldGroup>
        )}

        {step === "otp" && (
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
        )}

        {step === "details" && (
          <FieldGroup>
            <input
              name="displayName"
              aria-label="Display name"
              placeholder="Display name"
              required
              maxLength={255}
              className={groupInputClass}
            />
            <input
              name="password"
              type="password"
              aria-label="Password"
              placeholder="Password (at least 12 characters)"
              required
              minLength={12}
              maxLength={255}
              autoComplete="new-password"
              className={groupInputClass}
            />
          </FieldGroup>
        )}

        {error && <FormError>{error}</FormError>}

        <Button type="submit" size="lg" block disabled={pending || (step === "otp" && otp.length < OTP_LENGTH)}>
          {pending ? "Please wait…" : step === "details" ? "Create account" : "Continue"}
        </Button>

        <AuthLinks>
          {step === "email" && (
            <Link href="/login" className={authLinkClass}>
              Already have an account? Sign in
            </Link>
          )}
          {/* Only the code step goes back (to fix the email); a used code can't be checked again. */}
          {step === "otp" && (
            <button type="button" onClick={() => goTo("email")} className={authLinkClass}>
              Use a different email
            </button>
          )}
        </AuthLinks>
      </AuthCard>
    </AuthShell>
  );
}
