"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { authFetch, setSessionExpiredHandler } from "@/lib/api";
import { CreditTransactionHistory } from "../_account/credit-transaction-history";

interface AuthenticatedUser {
  uuid: string;
  displayName: string;
}

export default function TransactionsPage() {
  const router = useRouter();
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(
    () => setSessionExpiredHandler(() => router.push("/login")),
    [router],
  );

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      void authFetch("/api/users/me")
        .then((response) => {
          if (!response.ok) throw new Error("Not authenticated");
          return response.json() as Promise<AuthenticatedUser>;
        })
        .then((authenticatedUser) => {
          if (active) setUser(authenticatedUser);
        })
        .catch(() => {
          if (active) router.push("/login");
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 0);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [router]);

  if (loading) {
    return (
      <div className="flex min-h-full flex-1 items-center justify-center">
        <p role="status" className="text-muted fade-in">
          Loading transaction history…
        </p>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex min-h-full flex-col">
      <header className="glass-heavy sticky top-0 z-40 text-white">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex min-w-0 items-center gap-4">
            <Link href="/home" className="text-xl font-bold tracking-tight">
              FoC
            </Link>
            <Link
              href="/home?tab=profile"
              className="btn-press rounded-lg px-3 py-1.5 text-sm font-medium text-white/80 transition-colors hover:bg-white/10 hover:text-white"
            >
              Back to My Account
            </Link>
          </div>
          <div className="flex min-w-0 items-center gap-3">
            <span className="hidden truncate text-sm text-white/80 sm:inline">
              {user.displayName}
            </span>
            <Link
              href="/login"
              className="shrink-0 text-sm text-white/70 transition-colors hover:text-white"
            >
              Sign out
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
        <div className="mb-6">
          <p className="text-sm font-medium text-nus-orange">My Account</p>
          <h1 className="mt-1 text-3xl font-bold">Credit transactions</h1>
          <p className="mt-2 text-sm text-muted">
            Review every reservation, adjustment, transfer, and release involving
            your account.
          </p>
        </div>

        <CreditTransactionHistory userId={user.uuid} />
      </main>
    </div>
  );
}
