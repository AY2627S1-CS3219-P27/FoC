"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { authFetch, setSessionExpiredHandler } from "@/lib/api";
import { CreditTransactionHistory } from "../_account/credit-transaction-history";
import { ADMIN_TABS, TAB_ORDER, type Tab, type UserProfile } from "../_shared/types";
import { AppShell } from "../_shell/app-shell";

export default function TransactionsPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    // Revoke the refresh token server-side; leave even if that fails.
    await authFetch("/api/auth/sessions/current", { method: "DELETE" }).catch(() => null);
    router.push("/login");
  }

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
          return response.json() as Promise<UserProfile>;
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

  const tabs = TAB_ORDER.filter((t) => user.isAdmin || !ADMIN_TABS.includes(t));

  return (
    <AppShell
      tabs={tabs}
      tab="profile"
      onTab={(next: Tab) => router.push(`/home?tab=${next}`)}
      user={user}
      signingOut={signingOut}
      onSignOut={() => void signOut()}
    >
      <Link
        href="/home?tab=profile"
        className="btn-press -ml-3 mt-3 inline-flex items-center rounded-lg px-3 py-1.5 text-sm font-medium text-nus-orange transition-colors hover:bg-fill"
      >
        <span aria-hidden="true" className="mr-1.5 font-bold">&lt;</span>
        Back to My Account
      </Link>

      <div className="mt-4 mb-6">
        <h1 className="text-3xl font-bold">Credit transactions</h1>
        <p className="mt-2 text-sm text-muted">
          Review every reservation, adjustment, transfer, and release involving
          your account.
        </p>
      </div>

      <CreditTransactionHistory userId={user.uuid} />
    </AppShell>
  );
}
