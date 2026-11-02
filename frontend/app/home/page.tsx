"use client";

import NumberFlow from "@number-flow/react";
import { clsx } from "clsx";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AdminUserErrands } from "./_errands/admin-user-errands";
import { ErrandsTab } from "./_errands/errands-tab";
import { SupplierRequestsTab } from "./_admin/supplier-requests-tab";
import { SupplierStatusControl } from "./_admin/supplier-status-control";
import { UserAdminActions } from "./_admin/user-admin-actions";
import { CategoriesPanel } from "./_admin/categories-panel";
import { CreateUserForm } from "./_admin/create-user-form";
import { ArchiveAccount } from "./_account/archive-account";
import { MyRequests } from "./_suppliers/my-requests";
import { SupplierForm } from "./_suppliers/supplier-form";
import { authFetch, refreshSession, setSessionExpiredHandler } from "@/lib/api";
import { fetchFirst } from "@/lib/paging";
import { Avatar } from "@/components/ui/avatar";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, inputClass } from "@/components/ui/field";
import { PinIcon, PlusIcon, SearchIcon } from "@/components/ui/icons";
import { Card, EmptyState, LoadMore, PageHeader, Pill, SkeletonGrid } from "@/components/ui/layout";
import { Segmented } from "@/components/ui/segmented";
import { Sheet } from "@/components/ui/sheet";
import { DataToggle } from "@/components/dev/data-toggle";

interface UserProfile {
  uuid: string;
  email: string;
  displayName: string;
  profilePictureUrl: string | null;
  roles: string[];
  isAdmin: boolean;
}

interface CreditBalance {
  userId: string;
  creditBalance: number;
  reservedBalance: number;
}

type CreditBalanceStatus = "loading" | "ready" | "not-found" | "error";

interface SupplierItem {
  id: string;
  name: string;
  displayName: string;
  kind: string;
  categories: { id: string; name: string }[];
  building: { id: string; shortName: string } | null;
  floor: string;
  status: string;
  photoUrl: string | null;
  locationDescription?: string; // only on the single-supplier read, not the list
}

interface BuildingItem {
  id: string;
  canonicalName: string;
  shortName: string;
  coordinates?: { latitude: number; longitude: number };
}

interface CategoryItem {
  id: string;
  name: string;
}

interface UserListItem {
  uuid: string;
  email: string;
  displayName: string;
  roles: string[];
  profilePictureUrl: string | null;
  isAdmin?: boolean;
  isLocked?: boolean;
  isArchived?: boolean;
}

type Tab = "errands" | "suppliers" | "profile" | "users" | "requests";

const TAB_ORDER: Tab[] = ["errands", "suppliers", "profile", "users", "requests"];
const ADMIN_TABS: Tab[] = ["users", "requests"];

const isTab = (value: string | null): value is Tab => TAB_ORDER.includes(value as Tab);

const MAX_CARD_CATEGORIES = 3;
const SUPPLIER_PAGE = 24; // fills whole rows of the 2- and 3-column grids
const USERS_PAGE = 100;

async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    if (body && typeof body.message === "string") return body.message;
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
  const [user, setUser] = useState<UserProfile | null>(null);
  const [userLoading, setUserLoading] = useState(true);
  const searchParams = useSearchParams();
  const [tabDir, setTabDir] = useState<"left" | "right">("right");
  const [signingOut, setSigningOut] = useState(false);
  const [creditBalance, setCreditBalance] = useState<CreditBalance | null>(null);
  const [creditBalanceStatus, setCreditBalanceStatus] =
    useState<CreditBalanceStatus>("loading");

  const [suppliers, setSuppliers] = useState<SupplierItem[]>([]);
  const [buildings, setBuildings] = useState<BuildingItem[]>([]);
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [suppliersLoading, setSuppliersLoading] = useState(true);
  const [searchName, setSearchName] = useState("");
  const [filterBuilding, setFilterBuilding] = useState("");
  const [filterKind, setFilterKind] = useState("");
  const [selectedSupplier, setSelectedSupplier] = useState<string | null>(null);

  const [editingProfile, setEditingProfile] = useState(false);
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newProfilePictureUrl, setNewProfilePictureUrl] = useState("");
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

  const loadCreditBalance = useCallback(async () => {
    setCreditBalanceStatus("loading");

    try {
      const res = await authFetch("/api/credits/balance", {
        credentials: "same-origin",
      });

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

      const data = (await res.json()) as CreditBalance;
      setCreditBalance(data);
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
    // Only a fresh list shows the skeleton; loading more keeps the cards on screen.
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
    const timer = setTimeout(() => {
      void loadSuppliers();
    }, 0);
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

  async function handleProfileUpdate(e: React.FormEvent) {
    e.preventDefault();
    const trimmedUrl = newProfilePictureUrl.trim();
    const res = await authFetch("/api/users/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        displayName: newDisplayName,
        profilePictureUrl: trimmedUrl === "" ? null : trimmedUrl,
      }),
    });
    if (res.ok) {
      const updated = await res.json();
      setUser((prev) => (prev ? { ...prev, ...updated } : prev));
      setEditingProfile(false);
      if (updated.displayName !== user?.displayName) {
        toast.success("Profile updated", { description: "You may need to log in again." });
      } else {
        toast.success("Profile updated");
      }
    } else {
      toast.error(await errorMessage(res, "Failed to update profile."));
    }
  }

  async function handleRoleUpdate() {
    const res = await authFetch("/api/users/me/roles", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roles: selectedRoles }),
    });
    if (res.ok) {
      // A refreshed token carries the new roles, so no re-login is needed.
      const me = (await refreshSession()) ? await authFetch("/api/users/me") : null;
      if (me?.ok) {
        setUser((await me.json()) as UserProfile);
        toast.success("Roles updated");
      } else {
        toast.success("Roles updated", { description: "Please log in again to refresh your session." });
      }
    } else {
      toast.error("Failed to update roles.");
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
      const timer = setTimeout(() => {
        void loadAllUsers();
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [tab, user?.isAdmin, loadAllUsers]);

  function goTo(next: Tab) {
    setTabDir(TAB_ORDER.indexOf(next) < TAB_ORDER.indexOf(tab) ? "left" : "right");
    // Replace rather than push, so Back leaves the app instead of stepping through sections.
    const params = new URLSearchParams(window.location.search);
    params.set("tab", next);
    window.history.replaceState(null, "", `?${params}`);
  }

  async function signOut() {
    setSigningOut(true);
    // Revoke the refresh token server-side; leave even if that fails.
    await authFetch("/api/auth/sessions/current", { method: "DELETE" }).catch(() => null);
    router.push("/login");
  }

  function toggleRole(role: string) {
    setSelectedRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]
    );
  }

  if (userLoading) {
    return (
      <div className="flex flex-1 items-center justify-center" role="status">
        <span className="fade-in text-muted">Loading…</span>
      </div>
    );
  }

  const tabs: [Tab, string][] = [
    ["errands", "Errands"],
    ["suppliers", "Suppliers"],
    ["profile", "My Account"],
    ...(user?.isAdmin
      ? ([
          ["users", "Users"],
          ["requests", "Requests"],
        ] as [Tab, string][])
      : []),
  ];
  // Five tabs share a phone's width, so the strip uses the shorter label.
  const stripTabs = tabs.map(([t, label]): [Tab, string] => [t, t === "profile" ? "Account" : label]);

  return (
    <div className="flex min-h-full flex-col">
      <header className="glass-heavy sticky top-0 z-40 text-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4">
          <div className="flex min-w-0 items-center gap-6">
            <Link href="/home" className="shrink-0 text-lg font-bold tracking-tight">
              Fo<span className="text-nus-orange">C</span>
            </Link>
            <Segmented
              variant="nav"
              label="Sections"
              value={tab}
              onChange={goTo}
              items={tabs}
              className="hidden md:block"
            />
          </div>
          <div className="flex min-w-0 items-center gap-2.5">
            {user && (
              <Avatar
                url={user.profilePictureUrl}
                name={user.displayName}
                size={28}
                className="ring-2 ring-white/30"
              />
            )}
            <span className="hidden max-w-40 truncate text-sm text-white/85 lg:inline" title={user?.displayName}>
              {user?.displayName}
            </span>
            {user?.isAdmin && (
              <span className="shrink-0 rounded-full bg-nus-orange px-2 py-0.5 text-xs font-semibold">
                Admin
              </span>
            )}
            <button
              type="button"
              onClick={() => void signOut()}
              disabled={signingOut}
              className="btn-press shrink-0 rounded-lg px-2 py-1.5 text-sm text-white/75 hover:bg-white/10 hover:text-white disabled:opacity-60 pointer-coarse:py-2.5"
            >
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </div>
        <div className="border-t border-white/10 md:hidden">
          <Segmented variant="strip" label="Sections" value={tab} onChange={goTo} items={stripTabs} />
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-6 pb-16 sm:pt-8">
        <div key={tab} className="tab-enter" data-dir={tabDir}>
          {tab === "errands" && user && user.roles.length > 0 && (
            <ErrandsTab me={user.uuid} roles={user.roles} buildings={buildings} />
          )}
          {tab === "errands" && user && user.roles.length === 0 && (
            <>
              <PageHeader title="Errands" />
              <Card className="max-w-xl">
                <h2 className="text-lg font-semibold">
                  {user.isAdmin ? "Admins don't run errands" : "Pick a role to get started"}
                </h2>
                <p className="mt-1 mb-5 text-sm text-muted">
                  {user.isAdmin
                    ? "Admin accounts have no requester or courier role. Use the Users tab to view any user's errands."
                    : "Pick a role (requester or courier) on My Account, then sign in again to request or deliver errands."}
                </p>
                <Button onClick={() => goTo(user.isAdmin ? "users" : "profile")}>
                  {user.isAdmin ? "Go to Users" : "Go to My Account"}
                </Button>
              </Card>
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
              selectedSupplier={selectedSupplier}
              setSelectedSupplier={setSelectedSupplier}
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
                  onLoadMore={() =>
                    setSupplierPaging({ key: supplierKey, count: suppliersCount + SUPPLIER_PAGE })
                  }
                />
              }
            />
          )}

          {tab === "users" && user?.isAdmin && (
            <UsersTab
              users={allUsers}
              total={usersTotal}
              loading={usersLoading}
              currentUserId={user.uuid}
              onUserUpdated={(updated) =>
                setAllUsers((prev) => prev.map((u) => (u.uuid === updated.uuid ? updated : u)))
              }
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

          {tab === "requests" && user?.isAdmin && (
            <SupplierRequestsTab
              suppliers={suppliers}
              buildings={buildings}
              categories={categories}
              users={allUsers}
              onResolved={loadSuppliers}
            />
          )}

          {tab === "profile" && user && (
            <ProfileTab
              user={user}
              editingProfile={editingProfile}
              setEditingProfile={setEditingProfile}
              newDisplayName={newDisplayName}
              setNewDisplayName={setNewDisplayName}
              newProfilePictureUrl={newProfilePictureUrl}
              setNewProfilePictureUrl={setNewProfilePictureUrl}
              handleProfileUpdate={handleProfileUpdate}
              selectedRoles={selectedRoles}
              toggleRole={toggleRole}
              handleRoleUpdate={handleRoleUpdate}
              creditBalance={creditBalance}
              creditBalanceStatus={creditBalanceStatus}
              loadCreditBalance={loadCreditBalance}
            />
          )}
        </div>
      </main>
      {process.env.NODE_ENV === "development" && <DataToggle />}
    </div>
  );
}

function kindTone(kind: string): React.ComponentProps<typeof Pill>["tone"] {
  return kind === "Store" ? "orange" : kind === "Facility" ? "blue" : "neutral";
}

function SupplierSheet({
  supplier,
  onClose,
  isAdmin,
  onStatusChanged,
  buildings,
  categories,
  onSaved,
}: {
  supplier: SupplierItem;
  onClose: () => void;
  isAdmin: boolean;
  onStatusChanged: () => void;
  buildings: BuildingItem[];
  categories: CategoryItem[];
  onSaved: (message: string) => void;
}) {
  const [location, setLocation] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(0);

  useEffect(() => {
    authFetch(`/api/suppliers/${supplier.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { locationDescription?: string } | null) => setLocation(d?.locationDescription ?? null))
      .catch(() => setLocation(null));
  }, [supplier.id, saved]);

  return (
    <Sheet
      title={supplier.displayName}
      description={[supplier.kind, supplier.building?.shortName].filter(Boolean).join(" · ")}
      onClose={onClose}
    >
      <div className="space-y-5">
        <dl className="grid grid-cols-2 gap-3">
          <InfoTile label="Building" value={supplier.building?.shortName ?? "—"} />
          <InfoTile label="Floor" value={supplier.floor} />
          <InfoTile className="col-span-2" label="Location" value={location ?? "—"} />
          <InfoTile
            label="Status"
            value={
              <span className={supplier.status === "Active" ? "text-success" : "text-danger"}>
                {supplier.status}
              </span>
            }
          />
          <InfoTile label="Type" value={supplier.kind} />
        </dl>
        <div>
          <p className="mb-2 text-sm text-muted">Categories</p>
          <div className="flex flex-wrap gap-1.5">
            {supplier.categories.length === 0 && <span className="text-sm">—</span>}
            {supplier.categories.map((cat) => (
              <Pill key={cat.id} tone="orange" className="text-sm">
                {cat.name}
              </Pill>
            ))}
          </div>
        </div>
        {isAdmin && (
          <SupplierStatusControl
            supplierId={supplier.id}
            status={supplier.status}
            onChanged={onStatusChanged}
          />
        )}
        {editing ? (
          <SupplierForm
            mode={isAdmin ? "admin-edit" : "request-update"}
            supplierId={supplier.id}
            buildings={buildings}
            categories={categories}
            onDone={(message) => {
              setEditing(false);
              setSaved((n) => n + 1);
              onSaved(message);
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <Button intent="outline" size="sm" onClick={() => setEditing(true)}>
            {isAdmin ? "Edit supplier" : "Suggest a change"}
          </Button>
        )}
      </div>
    </Sheet>
  );
}

function InfoTile({
  label,
  value,
  className,
}: {
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx("min-w-0 rounded-xl bg-surface px-3.5 py-3", className)}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium break-words">{value}</dd>
    </div>
  );
}

type SupplierPanel = "add" | "categories" | "suggest" | "mine" | null;

function SuppliersTab({
  suppliers,
  buildings,
  categories,
  loading,
  searchName,
  setSearchName,
  filterBuilding,
  setFilterBuilding,
  filterKind,
  setFilterKind,
  selectedSupplier,
  setSelectedSupplier,
  isAdmin,
  onSuppliersChanged,
  onCategoriesChanged,
  footer,
}: {
  suppliers: SupplierItem[];
  buildings: BuildingItem[];
  categories: CategoryItem[];
  loading: boolean;
  searchName: string;
  setSearchName: (v: string) => void;
  filterBuilding: string;
  setFilterBuilding: (v: string) => void;
  filterKind: string;
  setFilterKind: (v: string) => void;
  selectedSupplier: string | null;
  setSelectedSupplier: (v: string | null) => void;
  isAdmin: boolean;
  onSuppliersChanged: () => void;
  onCategoriesChanged: () => void;
  footer: React.ReactNode;
}) {
  const selected = suppliers.find((s) => s.id === selectedSupplier);
  const [panel, setPanel] = useState<SupplierPanel>(null);
  const [requestsVersion, setRequestsVersion] = useState(0);

  const panelButtons: [Exclude<SupplierPanel, null>, string][] = isAdmin
    ? [
        ["add", "Add supplier"],
        ["categories", "Categories"],
      ]
    : [
        ["suggest", "Suggest a supplier"],
        ["mine", "My requests"],
      ];

  function done(message: string) {
    toast.success(message);
    setPanel(isAdmin ? null : "mine");
    setRequestsVersion((v) => v + 1);
    onSuppliersChanged();
  }

  const filtered = !!(searchName || filterBuilding || filterKind);

  return (
    <div>
      <PageHeader
        title="Supplier directory"
        subtitle="Browse campus pickup points for your errands."
        actions={panelButtons.map(([key, label]) => (
          <Button
            key={key}
            size="sm"
            intent={panel === key ? "primary" : "outline"}
            aria-pressed={panel === key}
            onClick={() => setPanel(panel === key ? null : key)}
          >
            {(key === "add" || key === "suggest") && <PlusIcon size={14} />}
            {label}
          </Button>
        ))}
      />

      {(panel === "add" || panel === "suggest") && (
        <div className="mb-6 max-w-2xl">
          <SupplierForm
            mode={panel === "add" ? "admin-create" : "request-create"}
            buildings={buildings}
            categories={categories}
            onDone={done}
            onCancel={() => setPanel(null)}
          />
        </div>
      )}
      {panel === "categories" && <CategoriesPanel categories={categories} onAdded={onCategoriesChanged} />}
      {panel === "mine" && (
        <div className="fade-in mb-6 max-w-2xl">
          <MyRequests
            reloadKey={requestsVersion}
            supplierName={(id) => suppliers.find((s) => s.id === id)?.displayName}
          />
        </div>
      )}

      <div className="mb-6 grid gap-3 sm:flex sm:flex-wrap">
        <label className="relative min-w-0 sm:min-w-[220px] sm:flex-1">
          <span className="sr-only">Search by name</span>
          <SearchIcon size={16} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted" />
          <input
            type="search"
            placeholder="Search by name…"
            value={searchName}
            onChange={(e) => setSearchName(e.target.value)}
            className={`w-full pl-10 ${inputClass}`}
          />
        </label>
        <select
          value={filterBuilding}
          onChange={(e) => setFilterBuilding(e.target.value)}
          className={inputClass}
          aria-label="Building"
        >
          <option value="">All buildings</option>
          {buildings.map((b) => (
            <option key={b.id} value={b.id}>
              {b.shortName}
            </option>
          ))}
        </select>
        <select
          value={filterKind}
          onChange={(e) => setFilterKind(e.target.value)}
          className={inputClass}
          aria-label="Type"
        >
          <option value="">All types</option>
          <option value="Store">Store</option>
          <option value="Facility">Facility</option>
          <option value="Landmark">Landmark</option>
        </select>
      </div>

      {loading ? (
        <SkeletonGrid />
      ) : suppliers.length === 0 ? (
        <EmptyState
          title="No suppliers found"
          body={
            filtered
              ? "Try adjusting your filters."
              : "Check if the supplier service is running."
          }
          action={
            filtered && (
              <Button
                intent="outline"
                size="sm"
                onClick={() => {
                  setSearchName("");
                  setFilterBuilding("");
                  setFilterKind("");
                }}
              >
                Clear filters
              </Button>
            )
          }
        />
      ) : (
        <div className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {suppliers.map((supplier) => {
            const extra = supplier.categories.length - MAX_CARD_CATEGORIES;
            return (
              <button
                key={supplier.id}
                type="button"
                onClick={() => setSelectedSupplier(supplier.id)}
                className="card-press flex min-w-0 flex-col rounded-2xl border border-border bg-surface p-4 text-left shadow-card"
              >
                <div className="mb-2 flex items-start justify-between gap-3">
                  <h3 className="min-w-0 font-semibold break-words line-clamp-2">{supplier.displayName}</h3>
                  <Pill tone={kindTone(supplier.kind)} className="shrink-0">
                    {supplier.kind}
                  </Pill>
                </div>
                <p className="mb-3 flex min-w-0 items-center gap-1.5 text-sm text-muted">
                  <PinIcon size={14} className="shrink-0" />
                  <span className="truncate">
                    {supplier.building?.shortName ?? "—"} · Floor {supplier.floor}
                  </span>
                </p>
                <div className="mt-auto flex flex-wrap gap-1">
                  {supplier.status !== "Active" && <Pill tone="danger">{supplier.status}</Pill>}
                  {supplier.categories.slice(0, MAX_CARD_CATEGORIES).map((cat) => (
                    <Pill key={cat.id} className="max-w-[10rem]">
                      {cat.name}
                    </Pill>
                  ))}
                  {extra > 0 && <Pill>+{extra}</Pill>}
                </div>
              </button>
            );
          })}
        </div>
      )}
      {!loading && suppliers.length > 0 && footer}

      {selected && (
        <SupplierSheet
          key={selected.id}
          supplier={selected}
          onClose={() => setSelectedSupplier(null)}
          isAdmin={isAdmin}
          onStatusChanged={onSuppliersChanged}
          buildings={buildings}
          categories={categories}
          onSaved={(message) => {
            toast.success(message);
            if (!isAdmin) setRequestsVersion((v) => v + 1);
            onSuppliersChanged();
          }}
        />
      )}
    </div>
  );
}

function UsersTab({
  users,
  total,
  loading,
  currentUserId,
  onUserUpdated,
  onUserCreated,
  footer,
}: {
  users: UserListItem[];
  total: number;
  loading: boolean;
  currentUserId: string;
  onUserUpdated: (user: UserListItem) => void;
  onUserCreated: (user: UserListItem) => void;
  footer: React.ReactNode;
}) {
  const [errandsOf, setErrandsOf] = useState<UserListItem | null>(null);
  const [creating, setCreating] = useState(false);
  return (
    <div>
      <PageHeader
        title="All users"
        subtitle={`${total.toLocaleString()} registered user${total !== 1 ? "s" : ""} on the platform.`}
        actions={
          !creating && (
            <Button size="sm" onClick={() => setCreating(true)}>
              <PlusIcon size={14} />
              Create user
            </Button>
          )
        }
      />

      {creating && (
        <CreateUserForm<UserListItem>
          onCreated={(created) => {
            setCreating(false);
            toast.success(`Created ${created.email}`, {
              description: "They set a password with “Forgot password”.",
            });
            onUserCreated(created);
          }}
          onCancel={() => setCreating(false)}
        />
      )}

      {loading ? (
        <div role="status" aria-label="Loading" className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-14 rounded-xl" />
          ))}
        </div>
      ) : users.length === 0 ? (
        <EmptyState title="No users found" />
      ) : (
        <>
          {/* Phones: one stacked row per user, so every action stays on screen. */}
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface shadow-card sm:hidden">
            {users.map((u) => (
              <li key={u.uuid} className="space-y-3 px-4 py-4">
                <UserIdentity user={u} isSelf={u.uuid === currentUserId} />
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pl-11">
                  <UserRoles roles={u.roles} />
                  <UserStatus user={u} />
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pl-11">
                  <Button intent="link" size="sm" onClick={() => setErrandsOf(u)}>
                    View errands
                  </Button>
                  <UserAdminActions user={u} isSelf={u.uuid === currentUserId} onUpdated={onUserUpdated} />
                </div>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-hidden rounded-2xl border border-border bg-surface shadow-card sm:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[48rem] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs tracking-wide text-muted uppercase">
                    <th className="px-4 py-3 font-medium">User</th>
                    <th className="px-4 py-3 font-medium">Roles</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Errands</th>
                    <th className="px-4 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr
                      key={u.uuid}
                      className="border-b border-border transition-colors duration-150 last:border-b-0 hover:bg-background/60"
                    >
                      <td className="max-w-[22rem] px-4 py-3">
                        <UserIdentity user={u} isSelf={u.uuid === currentUserId} />
                      </td>
                      <td className="px-4 py-3">
                        <UserRoles roles={u.roles} />
                      </td>
                      <td className="px-4 py-3">
                        <UserStatus user={u} />
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <Button intent="link" size="sm" onClick={() => setErrandsOf(u)}>
                          View errands
                        </Button>
                      </td>
                      <td className="px-4 py-3">
                        <UserAdminActions
                          user={u}
                          isSelf={u.uuid === currentUserId}
                          onUpdated={onUserUpdated}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {footer}
        </>
      )}
      {errandsOf && (
        <AdminUserErrands user={errandsOf} onClose={() => setErrandsOf(null)} />
      )}
    </div>
  );
}

function UserIdentity({ user, isSelf }: { user: UserListItem; isSelf: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar url={user.profilePictureUrl} name={user.displayName} size={32} />
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium" title={user.displayName}>
            {user.displayName}
          </span>
          {user.isAdmin && <Pill tone="orange" className="shrink-0">Admin</Pill>}
          {isSelf && <Pill className="shrink-0">You</Pill>}
        </div>
        <div className="truncate text-xs text-muted" title={user.email}>
          {user.email}
        </div>
      </div>
    </div>
  );
}

function UserRoles({ roles }: { roles: string[] }) {
  if (roles.length === 0) return <span className="text-xs text-muted">No roles</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {roles.map((role) => (
        <Pill key={role} tone="blue" className="capitalize">
          {role}
        </Pill>
      ))}
    </div>
  );
}

function UserStatus({ user }: { user: UserListItem }) {
  const [label, dot, text] = user.isLocked
    ? ["Locked", "bg-danger", "text-danger"]
    : user.isArchived
      ? ["Archived", "bg-muted", "text-muted"]
      : ["Active", "bg-success", "text-success"];
  return (
    <span className={clsx("inline-flex items-center gap-1.5 text-xs font-medium", text)}>
      <span aria-hidden="true" className={clsx("size-1.5 rounded-full", dot)} />
      {label}
    </span>
  );
}

function ProfileTab({
  user,
  editingProfile,
  setEditingProfile,
  newDisplayName,
  setNewDisplayName,
  newProfilePictureUrl,
  setNewProfilePictureUrl,
  handleProfileUpdate,
  selectedRoles,
  toggleRole,
  handleRoleUpdate,
  creditBalance,
  creditBalanceStatus,
  loadCreditBalance,
}: {
  user: UserProfile;
  editingProfile: boolean;
  setEditingProfile: (v: boolean) => void;
  newDisplayName: string;
  setNewDisplayName: (v: string) => void;
  newProfilePictureUrl: string;
  setNewProfilePictureUrl: (v: string) => void;
  handleProfileUpdate: (e: React.FormEvent) => void;
  selectedRoles: string[];
  toggleRole: (role: string) => void;
  handleRoleUpdate: () => void;
  creditBalance: CreditBalance | null;
  creditBalanceStatus: CreditBalanceStatus;
  loadCreditBalance: () => Promise<void>;
}) {
  const rolesChanged =
    selectedRoles.length !== user.roles.length || selectedRoles.some((r) => !user.roles.includes(r));

  return (
    <div className="max-w-2xl space-y-5">
      <PageHeader title="My account" />

      <Card aria-labelledby="profile-heading">
        {/* Edit wraps under the name on narrow screens instead of squeezing it mid-word. */}
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex min-w-0 flex-1 basis-60 items-center gap-4">
            <Avatar url={user.profilePictureUrl} name={user.displayName} size={56} />
            <div className="min-w-0 flex-1">
              <h2 id="profile-heading" className="text-lg font-semibold break-words">
                {user.displayName}
              </h2>
              <p className="text-sm text-muted [overflow-wrap:anywhere]">{user.email}</p>
            </div>
          </div>
          {!editingProfile && (
            <Button
              intent="outline"
              size="sm"
              onClick={() => {
                setNewDisplayName(user.displayName);
                setNewProfilePictureUrl(user.profilePictureUrl ?? "");
                setEditingProfile(true);
              }}
            >
              Edit
            </Button>
          )}
        </div>

        {editingProfile ? (
          <form onSubmit={handleProfileUpdate} className="fade-in mt-5 space-y-4 border-t border-border pt-5">
            <Field label="Display name">
              <input
                value={newDisplayName}
                onChange={(e) => setNewDisplayName(e.target.value)}
                required
                maxLength={255}
                className={`w-full ${inputClass}`}
              />
            </Field>
            <Field label="Profile picture URL" hint="Leave blank to remove your profile picture.">
              <input
                type="url"
                value={newProfilePictureUrl}
                onChange={(e) => setNewProfilePictureUrl(e.target.value)}
                placeholder="https://example.com/me.jpg"
                maxLength={2083}
                className={`w-full ${inputClass}`}
              />
            </Field>
            <div className="flex gap-2">
              <Button type="submit" size="sm">
                Save
              </Button>
              <Button intent="outline" size="sm" onClick={() => setEditingProfile(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <dl className="mt-5 border-t border-border pt-4 text-sm">
            <dt className="text-xs text-muted">User ID</dt>
            <dd className="mt-0.5 font-mono text-xs break-all">{user.uuid}</dd>
          </dl>
        )}
      </Card>

      <CreditBalanceCard
        balance={creditBalance}
        status={creditBalanceStatus}
        onRetry={loadCreditBalance}
      />

      <Card aria-labelledby="roles-heading">
        <h2 id="roles-heading" className="text-lg font-semibold">Errand roles</h2>
        <p className="mt-1 mb-4 text-sm text-muted">
          Choose how you want to participate on the platform.
        </p>
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          {["requester", "courier"].map((role) => {
            const on = selectedRoles.includes(role);
            return (
              <button
                key={role}
                type="button"
                aria-pressed={on}
                onClick={() => toggleRole(role)}
                className={clsx(
                  "btn-press rounded-xl border-2 px-4 py-3 text-left",
                  on
                    ? "border-nus-orange bg-nus-orange/8"
                    : "border-border hover:border-nus-orange/40",
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className={clsx("font-semibold capitalize", on && "text-nus-orange")}>{role}</span>
                  <span
                    aria-hidden="true"
                    className={clsx(
                      "flex size-5 items-center justify-center rounded-full border-2 transition-colors duration-150",
                      on ? "border-nus-orange bg-nus-orange" : "border-border",
                    )}
                  >
                    {on && <span className="size-1.5 rounded-full bg-white" />}
                  </span>
                </span>
                <span className="mt-0.5 block text-xs text-muted">
                  {role === "requester" ? "Request errands" : "Fulfil errands"}
                </span>
              </button>
            );
          })}
        </div>
        <Button intent="secondary" size="sm" onClick={handleRoleUpdate} disabled={!rolesChanged}>
          Update roles
        </Button>
      </Card>

      <Card aria-labelledby="security-heading">
        <h2 id="security-heading" className="text-lg font-semibold">Security</h2>
        <p className="mt-1 mb-4 text-sm text-muted">
          Manage your password and account security.
        </p>
        <Link href="/forgot-password" className={buttonVariants({ intent: "outline", size: "sm" })}>
          Reset password
        </Link>
      </Card>

      <ArchiveAccount />
    </div>
  );
}

function CreditBalanceCard({
  balance,
  status,
  onRetry,
}: {
  balance: CreditBalance | null;
  status: CreditBalanceStatus;
  onRetry: () => Promise<void>;
}) {
  return (
    <Card aria-labelledby="credit-balance-heading">
      <h2 id="credit-balance-heading" className="mb-4 text-lg font-semibold">
        Credit balance
      </h2>

      {status === "loading" && (
        <div role="status" aria-label="Loading credit balance" className="grid gap-3 sm:grid-cols-2">
          <div className="skeleton h-20 rounded-xl" />
          <div className="skeleton h-20 rounded-xl" />
        </div>
      )}

      {status === "ready" && balance && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <BalanceValue label="Available credits" value={balance.creditBalance} accent />
          <BalanceValue label="Reserved credits" value={balance.reservedBalance} />
        </div>
      )}

      {status === "not-found" && (
        <BalanceFailure
          message="Your credit account is still being prepared."
          onRetry={onRetry}
        />
      )}

      {status === "error" && (
        <BalanceFailure
          message="Credit balance is temporarily unavailable."
          onRetry={onRetry}
        />
      )}
    </Card>
  );
}

function BalanceValue({ label, value, accent = false }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="min-w-0 rounded-xl bg-background p-4">
      <span className="block text-sm text-muted">{label}</span>
      <NumberFlow
        value={value}
        className={clsx("tabular mt-1 block text-[1.75rem] font-bold tracking-tight", accent && "text-nus-orange")}
      />
    </div>
  );
}

function BalanceFailure({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => Promise<void>;
}) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted">{message}</p>
      <Button intent="outline" size="sm" onClick={() => void onRetry()}>
        Retry
      </Button>
    </div>
  );
}
