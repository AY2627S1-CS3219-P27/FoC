"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ErrandsTab } from "./_errands/errands-tab";
import { SupplierRequestsTab } from "./_admin/supplier-requests-tab";
import { UsersTab } from "./_admin/users-tab";
import { AccountTab } from "./_account/account-tab";
import { PushRegistrationSync } from "./_notifications/push-registration";
import { SuppliersTab } from "./_suppliers/suppliers-tab";
import { AppShell } from "./_shell/app-shell";
import {
  ADMIN_TABS,
  isTab,
  TAB_ORDER,
  type BuildingItem,
  type CategoryItem,
  type CreditBalance,
  type CreditBalanceStatus,
  type SupplierItem,
  type Tab,
  type UserListItem,
  type UserProfile,
} from "./_shared/types";
import { authFetch, refreshSession, setSessionExpiredHandler } from "@/lib/api";
import { arriveAt, pulseNavigation } from "@/lib/nav-pulse";
import { fetchFirst } from "@/lib/paging";
import { Button } from "@/components/ui/button";
import { RollingCubes } from "@/components/cubes";
import { LoadMore, PageHeader, Section } from "@/components/ui/layout";
import { DataToggle } from "@/components/dev/data-toggle";

const SUPPLIER_PAGE = 25;
const USERS_PAGE = 100;
// After the sign-in pages in the flow, so arriving from them rolls the cubes forward.
const HOME_PLACE = 10;

async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    if (body && typeof body.message === "string" && res.status < 500) return body.message;
  } catch {
    /* ignore non-JSON error bodies */
  }
  return fallback;
}

// Reading ?tab= needs a Suspense boundary, since the page is prerendered without search params.
export default function HomePage() {
  return (
    <Suspense>
      <Home />
    </Suspense>
  );
}

function Home() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [userLoading, setUserLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const [creditBalance, setCreditBalance] = useState<CreditBalance | null>(null);
  const [creditBalanceStatus, setCreditBalanceStatus] = useState<CreditBalanceStatus>("loading");

  const [suppliers, setSuppliers] = useState<SupplierItem[]>([]);
  const [buildings, setBuildings] = useState<BuildingItem[]>([]);
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [suppliersLoading, setSuppliersLoading] = useState(true);
  const [searchName, setSearchName] = useState("");
  const [filterBuilding, setFilterBuilding] = useState("");
  const [filterKind, setFilterKind] = useState("");

  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);

  // Admin users list state
  const [allUsers, setAllUsers] = useState<UserListItem[]>([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersCount, setUsersCount] = useState(USERS_PAGE);
  const isAdmin = user?.isAdmin ?? false;

  // The URL is the source of truth, so a refresh or shared link lands on the same section.
  const requestedTab = searchParams.get("tab");
  const tab: Tab =
    isTab(requestedTab) && (isAdmin || !ADMIN_TABS.includes(requestedTab))
      ? requestedTab
      : isAdmin && user?.roles.length === 0
        ? "users"
        : "errands";

  useEffect(() => arriveAt(HOME_PLACE), []);

  const loadCreditBalance = useCallback(async () => {
    setCreditBalanceStatus("loading");
    try {
      const res = await authFetch("/api/credits/balance", { credentials: "same-origin" });
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      if (res.status === 404) {
        setCreditBalance(null);
        setCreditBalanceStatus("not-found");
        return;
      }
      if (!res.ok) throw new Error("Credit balance request failed");
      setCreditBalance((await res.json()) as CreditBalance);
      setCreditBalanceStatus("ready");
    } catch {
      setCreditBalance(null);
      setCreditBalanceStatus("error");
    }
  }, [router]);

  useEffect(() => setSessionExpiredHandler(() => router.push("/login")), [router]);

  useEffect(() => {
    authFetch("/api/users/me")
      .then((res) => {
        if (!res.ok) throw new Error("Not authenticated");
        return res.json();
      })
      .then((data: UserProfile) => {
        setUser(data);
        setSelectedRoles(data.roles);
        void loadCreditBalance();
      })
      .catch(() => router.push("/login"))
      .finally(() => setUserLoading(false));
  }, [loadCreditBalance, router]);

  // "Load more" grows the count; a new search or filter starts again from one page.
  const supplierKey = JSON.stringify([searchName, filterBuilding, filterKind]);
  const [supplierPaging, setSupplierPaging] = useState({ key: supplierKey, count: SUPPLIER_PAGE });
  const suppliersCount = supplierPaging.key === supplierKey ? supplierPaging.count : SUPPLIER_PAGE;
  const [suppliersPage, setSuppliersPage] = useState<{ total: number | null; hasMore: boolean }>({
    total: null,
    hasMore: false,
  });

  const loadSuppliers = useCallback(async () => {
    // Only a fresh list shows the skeleton; loading more keeps the rows on screen.
    if (suppliersCount === SUPPLIER_PAGE) setSuppliersLoading(true);
    try {
      const params = new URLSearchParams();
      // Admins also see Inactive suppliers, so they can reactivate them.
      if (!isAdmin) params.set("status", "Active");
      if (searchName) params.set("name", searchName);
      if (filterBuilding) params.set("buildingId", filterBuilding);
      if (filterKind) params.set("kind", filterKind);
      const loaded = await fetchFirst<SupplierItem>(suppliersCount, 1000, async (offset, limit) => {
        params.set("offset", String(offset));
        params.set("limit", String(limit));
        const res = await authFetch(`/api/suppliers?${params}`);
        return res.ok ? res.json() : null;
      });
      if (loaded) {
        setSuppliers(loaded.items);
        setSuppliersPage({ total: loaded.total, hasMore: loaded.hasMore });
      }
    } catch {
      /* supplier service might not be running */
    }
    setSuppliersLoading(false);
  }, [searchName, filterBuilding, filterKind, isAdmin, suppliersCount]);

  useEffect(() => {
    const timer = setTimeout(() => void loadSuppliers(), 0);
    return () => clearTimeout(timer);
  }, [loadSuppliers]);

  const loadCategories = useCallback(async () => {
    const c = await authFetch("/api/categories")
      .then((r) => r.json())
      .catch(() => []);
    setCategories(Array.isArray(c) ? c : []);
  }, []);

  useEffect(() => {
    authFetch("/api/buildings")
      .then((r) => r.json())
      .catch(() => [])
      .then((b) => setBuildings(Array.isArray(b) ? b : []));
    const timer = setTimeout(() => void loadCategories(), 0);
    return () => clearTimeout(timer);
  }, [loadCategories]);

  async function saveProfile(displayName: string, pictureUrl: string): Promise<boolean> {
    const trimmedUrl = pictureUrl.trim();
    const res = await authFetch("/api/users/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName, profilePictureUrl: trimmedUrl === "" ? null : trimmedUrl }),
    });
    if (!res.ok) {
      toast.error(await errorMessage(res, "Couldn't update your profile."));
      return false;
    }
    const updated = await res.json();
    const renamed = updated.displayName !== user?.displayName;
    setUser((prev) => (prev ? { ...prev, ...updated } : prev));
    toast.success("Profile updated", renamed ? { description: "You may need to sign in again." } : undefined);
    return true;
  }

  async function saveRoles() {
    const res = await authFetch("/api/users/me/roles", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roles: selectedRoles }),
    });
    if (!res.ok) {
      toast.error("Couldn't update your roles.");
      return;
    }
    // A refreshed token carries the new roles, so no re-login is needed.
    const me = (await refreshSession()) ? await authFetch("/api/users/me") : null;
    if (me?.ok) {
      setUser((await me.json()) as UserProfile);
      toast.success("Roles updated");
    } else {
      toast.success("Roles updated", { description: "Sign in again to refresh your session." });
    }
  }

  const loadAllUsers = useCallback(async () => {
    if (usersCount === USERS_PAGE) setUsersLoading(true);
    try {
      const loaded = await fetchFirst<UserListItem>(usersCount, 1000, async (offset, limit) => {
        const res = await authFetch(`/api/users?offset=${offset}&limit=${limit}`);
        return res.ok ? res.json() : null;
      });
      if (loaded) {
        setAllUsers(loaded.items);
        setUsersTotal(loaded.total ?? loaded.items.length);
      }
    } catch {
      /* user service might not be running */
    }
    setUsersLoading(false);
  }, [usersCount]);

  useEffect(() => {
    if ((tab === "users" || tab === "requests") && user?.isAdmin) {
      const timer = setTimeout(() => void loadAllUsers(), 0);
      return () => clearTimeout(timer);
    }
  }, [tab, user?.isAdmin, loadAllUsers]);

  function goTo(next: Tab) {
    if (next === tab) {
      // Tapping the current tab again scrolls back to the top, as tab bars do.
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    pulseNavigation(TAB_ORDER.indexOf(next) < TAB_ORDER.indexOf(tab) ? "back" : "forward");
    // Replace rather than push, so Back leaves the app instead of stepping through sections.
    const params = new URLSearchParams(window.location.search);
    params.set("tab", next);
    window.history.replaceState(null, "", `?${params}`);
    window.scrollTo({ top: 0 });
  }

  async function signOut() {
    setSigningOut(true);
    // Revoke the refresh token server-side; leave even if that fails.
    await authFetch("/api/auth/sessions/current", { method: "DELETE" }).catch(() => null);
    router.push("/login");
  }

  function toggleRole(role: string) {
    setSelectedRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));
  }

  if (userLoading || !user) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2" role="status" aria-label="Loading">
        <RollingCubes size={14} className="h-20 w-32" />
      </div>
    );
  }

  const tabs = TAB_ORDER.filter((t) => user.isAdmin || !ADMIN_TABS.includes(t));

  return (
    <AppShell tabs={tabs} tab={tab} onTab={goTo} user={user} signingOut={signingOut} onSignOut={() => void signOut()}>
      <PushRegistrationSync />
      <div key={tab} className="tab-enter">
        {tab === "errands" && user.roles.length > 0 && (
          <ErrandsTab me={user.uuid} roles={user.roles} buildings={buildings} />
        )}
        {tab === "errands" && user.roles.length === 0 && (
          <>
            <PageHeader title="Errands" />
            <Section
              footer={
                user.isAdmin
                  ? "Admin accounts have no requester or courier role. Open Users to see anyone's errands."
                  : "Turn on the requester or courier role in Account to request or deliver errands."
              }
            >
              <div className="flex flex-col items-center px-6 py-8 text-center">
                <p className="text-[17px] font-semibold">
                  {user.isAdmin ? "Admins don't run errands" : "Pick a role to get started"}
                </p>
                <Button intent="tinted" size="sm" className="mt-4" onClick={() => goTo(user.isAdmin ? "users" : "profile")}>
                  {user.isAdmin ? "Go to Users" : "Go to Account"}
                </Button>
              </div>
            </Section>
          </>
        )}

        {tab === "suppliers" && (
          <SuppliersTab
            suppliers={suppliers}
            buildings={buildings}
            categories={categories}
            loading={suppliersLoading}
            searchName={searchName}
            setSearchName={setSearchName}
            filterBuilding={filterBuilding}
            setFilterBuilding={setFilterBuilding}
            filterKind={filterKind}
            setFilterKind={setFilterKind}
            isAdmin={isAdmin}
            onSuppliersChanged={loadSuppliers}
            onCategoriesChanged={loadCategories}
            footer={
              <LoadMore
                noun="suppliers"
                shown={suppliers.length}
                total={suppliersPage.total}
                hasMore={suppliersPage.hasMore}
                loading={suppliers.length < suppliersCount && suppliersPage.hasMore}
                onLoadMore={() => setSupplierPaging({ key: supplierKey, count: suppliersCount + SUPPLIER_PAGE })}
              />
            }
          />
        )}

        {tab === "users" && user.isAdmin && (
          <UsersTab
            users={allUsers}
            total={usersTotal}
            loading={usersLoading}
            currentUserId={user.uuid}
            onUserUpdated={(updated) => setAllUsers((prev) => prev.map((u) => (u.uuid === updated.uuid ? updated : u)))}
            onUserCreated={(created) => {
              setAllUsers((prev) => [created, ...prev]);
              setUsersTotal((t) => t + 1);
            }}
            footer={
              <LoadMore
                noun="users"
                shown={allUsers.length}
                total={usersTotal}
                hasMore={allUsers.length < usersTotal}
                loading={allUsers.length < usersCount && allUsers.length < usersTotal}
                onLoadMore={() => setUsersCount((c) => c + USERS_PAGE)}
              />
            }
          />
        )}

        {tab === "requests" && user.isAdmin && (
          <SupplierRequestsTab
            suppliers={suppliers}
            buildings={buildings}
            categories={categories}
            users={allUsers}
            onResolved={loadSuppliers}
          />
        )}

        {tab === "profile" && (
          <AccountTab
            user={user}
            selectedRoles={selectedRoles}
            toggleRole={toggleRole}
            onSaveRoles={saveRoles}
            onSaveProfile={saveProfile}
            creditBalance={creditBalance}
            creditBalanceStatus={creditBalanceStatus}
            loadCreditBalance={loadCreditBalance}
            signingOut={signingOut}
            onSignOut={() => void signOut()}
          />
        )}
      </div>
      {process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_FOC_FIXTURES === "1" && <DataToggle />}
    </AppShell>
  );
}
