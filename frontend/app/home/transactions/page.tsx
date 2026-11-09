"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { authFetch, setSessionExpiredHandler } from "@/lib/api";
import { ChevronLeftIcon } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/layout";
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
        className="btn-press -ml-1 mt-3 mb-1 inline-flex items-center gap-0.5 rounded-lg py-1.5 pr-2 text-[15px] font-medium text-nus-orange"
      >
        <ChevronLeftIcon size={18} strokeWidth={2.5} />
        Account
      </Link>

      <PageHeader
        title="Transactions"
        subtitle="Movements into, out of, and within your credit account."
      />

      <CreditTransactionHistory userId={user.uuid} />
    </AppShell>
  );
}
