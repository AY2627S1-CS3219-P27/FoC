"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AdminUserErrands } from "./_errands/admin-user-errands";
import { ApiLogPanel } from "./_errands/api-log-panel";
import { ErrandsTab } from "./_errands/errands-tab";
import { SupplierRequestsTab } from "./_admin/supplier-requests-tab";
import { SupplierStatusControl } from "./_admin/supplier-status-control";
import { UserAdminActions } from "./_admin/user-admin-actions";
import { authFetch, refreshSession, setSessionExpiredHandler } from "@/lib/api";

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

export default function HomePage() {
  const router = useRouter();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [userLoading, setUserLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("errands");
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
  const [profileMsg, setProfileMsg] = useState("");
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [roleMsg, setRoleMsg] = useState("");

  // Admin users list state
  const [allUsers, setAllUsers] = useState<UserListItem[]>([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [usersLoading, setUsersLoading] = useState(false);
  const isAdmin = user?.isAdmin ?? false;

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
        if (data.isAdmin && data.roles.length === 0) setTab("users");
        void loadCreditBalance();
      })
      .catch(() => router.push("/login"))
      .finally(() => setUserLoading(false));
  }, [loadCreditBalance, router]);

  const loadSuppliers = useCallback(async () => {
    setSuppliersLoading(true);
    try {
      const params = new URLSearchParams();
      // Admins also see Inactive suppliers, so they can reactivate them.
      if (!isAdmin) params.set("status", "Active");
      if (searchName) params.set("name", searchName);
      if (filterBuilding) params.set("buildingId", filterBuilding);
      if (filterKind) params.set("kind", filterKind);
      const res = await authFetch(`/api/suppliers?${params}`);
      if (res.ok) {
        const data = await res.json();
        setSuppliers(data.items);
      }
    } catch {
      /* supplier service might not be running */
    }
    setSuppliersLoading(false);
  }, [searchName, filterBuilding, filterKind, isAdmin]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadSuppliers();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadSuppliers]);

  useEffect(() => {
    Promise.all([
      authFetch("/api/buildings")
        .then((r) => r.json())
        .catch(() => []),
      authFetch("/api/categories")
        .then((r) => r.json())
        .catch(() => []),
    ]).then(([b, c]) => {
      setBuildings(Array.isArray(b) ? b : []);
      setCategories(Array.isArray(c) ? c : []);
    });
  }, []);

  async function handleProfileUpdate(e: React.FormEvent) {
    e.preventDefault();
    setProfileMsg("");
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
      setProfileMsg(
        updated.displayName !== user?.displayName
          ? "Profile updated. You may need to log in again."
          : "Profile updated.",
      );
    } else {
      let message = "Failed to update profile.";
      try {
        const errBody = await res.json();
        if (errBody && typeof errBody.message === "string") {
          message = errBody.message;
        }
      } catch {
        /* ignore non-JSON error bodies */
      }
      setProfileMsg(message);
    }
  }

  async function handleRoleUpdate() {
    setRoleMsg("");
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
        setRoleMsg("Roles updated.");
      } else {
        setRoleMsg("Roles updated. Please log in again to refresh your session.");
      }
    } else {
      setRoleMsg("Failed to update roles.");
    }
  }

  const loadAllUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const res = await authFetch("/api/users?limit=100");
      if (res.ok) {
        const data = await res.json();
        setAllUsers(data.items);
        setUsersTotal(data.total);
      }
    } catch {
      /* user service might not be running */
    }
    setUsersLoading(false);
  }, []);

  useEffect(() => {
    if ((tab === "users" || tab === "requests") && user?.isAdmin) {
      const timer = setTimeout(() => {
        void loadAllUsers();
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [tab, user?.isAdmin, loadAllUsers]);

  function toggleRole(role: string) {
    setSelectedRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]
    );
  }

  if (userLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-muted fade-in">Loading...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-full">
      {/* Translucent navigation bar (§12: glass material) */}
      <header className="glass-heavy text-white sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/home" className="text-xl font-bold tracking-tight">
              FoC
            </Link>
            <nav className="hidden sm:flex gap-1">
              <button
                onClick={() => setTab("errands")}
                className={`btn-press px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  tab === "errands"
                    ? "bg-white/20 text-white"
                    : "text-white/70 hover:text-white hover:bg-white/10"
                }`}
              >
                Errands
              </button>
              <button
                onClick={() => setTab("suppliers")}
                className={`btn-press px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  tab === "suppliers"
                    ? "bg-white/20 text-white"
                    : "text-white/70 hover:text-white hover:bg-white/10"
                }`}
              >
                Suppliers
              </button>
              <button
                onClick={() => setTab("profile")}
                className={`btn-press px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  tab === "profile"
                    ? "bg-white/20 text-white"
                    : "text-white/70 hover:text-white hover:bg-white/10"
                }`}
              >
                My Account
              </button>
              {user?.isAdmin && (
                <button
                  onClick={() => setTab("users")}
                  className={`btn-press px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    tab === "users"
                      ? "bg-white/20 text-white"
                      : "text-white/70 hover:text-white hover:bg-white/10"
                  }`}
                >
                  Users
                </button>
              )}
              {user?.isAdmin && (
                <button
                  onClick={() => setTab("requests")}
                  className={`btn-press px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    tab === "requests"
                      ? "bg-white/20 text-white"
                      : "text-white/70 hover:text-white hover:bg-white/10"
                  }`}
                >
                  Requests
                </button>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            {user && <Avatar url={user.profilePictureUrl} size={28} ring />}
            <span className="text-sm text-white/80 hidden sm:inline">
              {user?.displayName}
            </span>
            {user?.isAdmin && (
              <span className="text-xs bg-nus-orange px-2 py-0.5 rounded-full font-medium">
                Admin
              </span>
            )}
            <Link
              href="/login"
              className="text-sm text-white/70 hover:text-white transition-colors"
            >
              Sign out
            </Link>
          </div>
        </div>
        {/* Mobile tabs */}
        <div className="sm:hidden flex border-t border-white/10">
          <button
            onClick={() => setTab("errands")}
            className={`btn-press flex-1 py-2.5 text-sm font-medium transition-colors ${tab === "errands" ? "bg-white/15 text-white" : "text-white/60"}`}
          >
            Errands
          </button>
          <button
            onClick={() => setTab("suppliers")}
            className={`btn-press flex-1 py-2.5 text-sm font-medium transition-colors ${tab === "suppliers" ? "bg-white/15 text-white" : "text-white/60"}`}
          >
            Suppliers
          </button>
          <button
            onClick={() => setTab("profile")}
            className={`btn-press flex-1 py-2.5 text-sm font-medium transition-colors ${tab === "profile" ? "bg-white/15 text-white" : "text-white/60"}`}
          >
            My Account
          </button>
          {user?.isAdmin && (
            <button
              onClick={() => setTab("users")}
              className={`btn-press flex-1 py-2.5 text-sm font-medium transition-colors ${tab === "users" ? "bg-white/15 text-white" : "text-white/60"}`}
            >
              Users
            </button>
          )}
          {user?.isAdmin && (
            <button
              onClick={() => setTab("requests")}
              className={`btn-press flex-1 py-2.5 text-sm font-medium transition-colors ${tab === "requests" ? "bg-white/15 text-white" : "text-white/60"}`}
            >
              Requests
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-6">
        <div key={tab} className="fade-in">
          {tab === "errands" && user && user.roles.length > 0 && (
            <ErrandsTab me={user.uuid} roles={user.roles} buildings={buildings} />
          )}
          {tab === "errands" && user && user.roles.length === 0 && (
            <div className="max-w-xl rounded-2xl border border-border bg-surface p-6 shadow-sm">
              <h2 className="text-xl font-bold mb-1">Errands</h2>
              <p className="text-sm text-muted mb-4">
                {user.isAdmin
                  ? "Admin accounts have no requester or courier role. Use the Users tab to view any user's errands."
                  : "Pick a role (requester or courier) on My Account, then sign in again to request or deliver errands."}
              </p>
              <button
                onClick={() => setTab(user.isAdmin ? "users" : "profile")}
                className="btn-press rounded-xl bg-nus-orange px-4 py-2 text-sm font-semibold text-white hover:bg-nus-orange-hover transition-colors"
              >
                {user.isAdmin ? "Go to Users" : "Go to My Account"}
              </button>
            </div>
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
              profileMsg={profileMsg}
              handleProfileUpdate={handleProfileUpdate}
              selectedRoles={selectedRoles}
              toggleRole={toggleRole}
              handleRoleUpdate={handleRoleUpdate}
              roleMsg={roleMsg}
              creditBalance={creditBalance}
              creditBalanceStatus={creditBalanceStatus}
              loadCreditBalance={loadCreditBalance}
            />
          )}
        </div>
      </main>
      <ApiLogPanel />
    </div>
  );
}

/* --- Supplier detail drawer with spatial animation (§7) --- */

function SupplierDrawer({
  supplier,
  onClose,
  isAdmin,
  onStatusChanged,
}: {
  supplier: SupplierItem;
  onClose: () => void;
  isAdmin: boolean;
  onStatusChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [location, setLocation] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    authFetch(`/api/suppliers/${supplier.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { locationDescription?: string } | null) => setLocation(d?.locationDescription ?? null))
      .catch(() => setLocation(null));
  }, [supplier.id]);

  useEffect(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setOpen(true));
    });
  }, []);

  function handleClose() {
    setOpen(false);
    const panel = panelRef.current;
    if (panel) {
      panel.addEventListener("transitionend", onClose, { once: true });
    } else {
      onClose();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className={`absolute inset-0 scrim drawer-backdrop ${open ? "open" : ""}`}
        onClick={handleClose}
      />
      <div
        ref={panelRef}
        className={`relative w-full max-w-md bg-background border-l border-border overflow-y-auto drawer-panel ${open ? "open" : ""}`}
      >
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-xl font-bold">{supplier.displayName}</h3>
            <button
              onClick={handleClose}
              className="btn-press flex items-center justify-center w-8 h-8 rounded-full bg-surface text-muted hover:text-foreground transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M4 4l8 8M12 4l-8 8"/>
              </svg>
            </button>
          </div>

          <div className="space-y-4">
            <InfoRow label="Type" value={supplier.kind} />
            <InfoRow
              label="Building"
              value={supplier.building?.shortName ?? "—"}
            />
            <InfoRow label="Floor" value={supplier.floor} />
            <InfoRow label="Location" value={location ?? "—"} />
            <InfoRow
              label="Status"
              value={
                <span
                  className={
                    supplier.status === "Active"
                      ? "text-success"
                      : "text-danger"
                  }
                >
                  {supplier.status}
                </span>
              }
            />
            <div>
              <span className="text-sm text-muted block mb-1.5">
                Categories
              </span>
              <div className="flex flex-wrap gap-1.5">
                {supplier.categories.map((cat) => (
                  <span
                    key={cat.id}
                    className="text-sm bg-nus-orange/10 text-nus-orange px-2.5 py-1 rounded-full font-medium"
                  >
                    {cat.name}
                  </span>
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
          </div>
        </div>
      </div>
    </div>
  );
}

function SuppliersTab({
  suppliers,
  buildings,
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
}) {
  const selected = suppliers.find((s) => s.id === selectedSupplier);

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold mb-1">Supplier Directory</h2>
        <p className="text-muted text-sm">
          Browse campus pickup points for your errands.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <input
          type="text"
          placeholder="Search by name…"
          value={searchName}
          onChange={(e) => setSearchName(e.target.value)}
          className="flex-1 min-w-[200px] rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm transition-shadow"
        />
        <select
          value={filterBuilding}
          onChange={(e) => setFilterBuilding(e.target.value)}
          className="rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm transition-shadow"
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
          className="rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm transition-shadow"
        >
          <option value="">All types</option>
          <option value="Store">Store</option>
          <option value="Facility">Facility</option>
          <option value="Landmark">Landmark</option>
        </select>
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted fade-in">
          Loading suppliers...
        </div>
      ) : suppliers.length === 0 ? (
        <div className="text-center py-12 fade-in">
          <p className="text-muted text-lg">No suppliers found</p>
          <p className="text-muted text-sm mt-1">
            Try adjusting your filters or check if the supplier service is
            running.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {suppliers.map((supplier) => (
            <button
              key={supplier.id}
              onClick={() =>
                setSelectedSupplier(
                  selectedSupplier === supplier.id ? null : supplier.id
                )
              }
              className={`card-press text-left rounded-2xl border p-4 hover:shadow-md ${
                selectedSupplier === supplier.id
                  ? "border-nus-orange ring-2 ring-nus-orange/30 bg-surface"
                  : "border-border bg-surface hover:border-nus-orange/50"
              }`}
            >
              <div className="flex items-start justify-between mb-2">
                <h3 className="font-semibold text-foreground">
                  {supplier.displayName}
                </h3>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    supplier.kind === "Store"
                      ? "bg-nus-orange/10 text-nus-orange"
                      : supplier.kind === "Facility"
                        ? "bg-nus-blue/10 text-nus-blue"
                        : "bg-muted/10 text-muted"
                  }`}
                >
                  {supplier.kind}
                </span>
              </div>
              {supplier.status !== "Active" && (
                <span className="inline-block text-xs bg-danger/10 text-danger px-2 py-0.5 rounded-full font-medium mb-2">
                  {supplier.status}
                </span>
              )}
              <p className="text-sm text-muted mb-2">
                Floor {supplier.floor}
              </p>
              <div className="flex flex-wrap gap-1">
                {supplier.categories.map((cat) => (
                  <span
                    key={cat.id}
                    className="text-xs bg-border/50 text-muted px-2 py-0.5 rounded-full"
                  >
                    {cat.name}
                  </span>
                ))}
              </div>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <SupplierDrawer
          supplier={selected}
          onClose={() => setSelectedSupplier(null)}
          isAdmin={isAdmin}
          onStatusChanged={onSuppliersChanged}
        />
      )}
    </div>
  );
}

function InfoRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <span className="text-sm text-muted block">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

function UsersTab({
  users,
  total,
  loading,
  currentUserId,
  onUserUpdated,
}: {
  users: UserListItem[];
  total: number;
  loading: boolean;
  currentUserId: string;
  onUserUpdated: (user: UserListItem) => void;
}) {
  const [errandsOf, setErrandsOf] = useState<UserListItem | null>(null);
  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold mb-1">All Users</h2>
        <p className="text-muted text-sm">
          {total} registered user{total !== 1 ? "s" : ""} on the platform.
        </p>
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted fade-in">
          Loading users...
        </div>
      ) : users.length === 0 ? (
        <div className="text-center py-12 fade-in">
          <p className="text-muted text-lg">No users found</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-surface shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted">
                  <th className="px-4 py-3 font-medium">Display Name</th>
                  <th className="px-4 py-3 font-medium">Email</th>
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
                    className="border-b border-border last:border-b-0 hover:bg-background/50 transition-colors"
                  >
                    <td className="px-4 py-3 font-medium">
                      <div className="flex items-center gap-2">
                        {u.displayName}
                        {u.isAdmin && (
                          <span className="text-xs bg-nus-orange/10 text-nus-orange px-1.5 py-0.5 rounded-full font-medium">
                            Admin
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted">{u.email}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        {u.roles.length > 0 ? (
                          u.roles.map((role) => (
                            <span
                              key={role}
                              className="text-xs bg-nus-blue/10 text-nus-blue px-2 py-0.5 rounded-full capitalize"
                            >
                              {role}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-muted">None</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {u.isLocked ? (
                        <span className="text-xs text-danger font-medium">Locked</span>
                      ) : u.isArchived ? (
                        <span className="text-xs text-muted font-medium">Archived</span>
                      ) : (
                        <span className="text-xs text-success font-medium">Active</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setErrandsOf(u)}
                        className="btn-press text-sm text-nus-blue hover:underline"
                      >
                        View errands
                      </button>
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
      )}
      {errandsOf && (
        <AdminUserErrands user={errandsOf} onClose={() => setErrandsOf(null)} />
      )}
    </div>
  );
}

function Avatar({
  url,
  size = 64,
  ring = false,
}: {
  url: string | null;
  size?: number;
  ring?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  const showImage = !!url && !broken;

  let picture: React.ReactNode;
  if (showImage) {
    picture = (
      // eslint-disable-next-line @next/next/no-img-element -- remote URLs; next/image would need remotePatterns config
      <img
        src={url ?? ""}
        alt="Profile picture"
        width={size}
        height={size}
        className="h-full w-full object-cover"
        onError={() => setBroken(true)}
      />
    );
  } else {
    picture = (
      <svg
        width={size * 0.52}
        height={size * 0.52}
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
      </svg>
    );
  }

  return (
    <span
      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface text-muted"
      style={{
        width: size,
        height: size,
        boxShadow: ring ? "0 0 0 2px rgba(255,255,255,0.35)" : undefined,
      }}
    >
      {picture}
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
  profileMsg,
  handleProfileUpdate,
  selectedRoles,
  toggleRole,
  handleRoleUpdate,
  roleMsg,
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
  profileMsg: string;
  handleProfileUpdate: (e: React.FormEvent) => void;
  selectedRoles: string[];
  toggleRole: (role: string) => void;
  handleRoleUpdate: () => void;
  roleMsg: string;
  creditBalance: CreditBalance | null;
  creditBalanceStatus: CreditBalanceStatus;
  loadCreditBalance: () => Promise<void>;
}) {
  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl font-bold mb-6">My Account</h2>

      <CreditBalanceCard
        balance={creditBalance}
        status={creditBalanceStatus}
        onRetry={loadCreditBalance}
      />

      {/* Profile card */}
      <div className="rounded-2xl border border-border bg-surface p-6 mb-6 shadow-sm">
        <h3 className="text-lg font-semibold mb-4">Profile</h3>
        <div className="space-y-3">
          <div className="pb-1">
            <Avatar url={user.profilePictureUrl} size={72} />
          </div>
          <InfoRow label="Email" value={user.email} />
          <InfoRow label="User ID" value={user.uuid} />

          {editingProfile ? (
            <form onSubmit={handleProfileUpdate} className="space-y-3 pt-2 fade-in">
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Display name
                </label>
                <input
                  value={newDisplayName}
                  onChange={(e) => setNewDisplayName(e.target.value)}
                  required
                  maxLength={255}
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm transition-shadow"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Profile picture URL
                </label>
                <input
                  type="url"
                  value={newProfilePictureUrl}
                  onChange={(e) => setNewProfilePictureUrl(e.target.value)}
                  placeholder="https://example.com/me.jpg"
                  maxLength={2083}
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm transition-shadow"
                />
                <p className="text-xs text-muted mt-1">
                  Leave blank to remove your profile picture.
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  className="btn-press rounded-xl bg-nus-orange px-4 py-2 text-sm font-semibold text-white hover:bg-nus-orange-hover transition-colors"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setEditingProfile(false)}
                  className="btn-press rounded-xl border border-border px-4 py-2 text-sm hover:bg-background transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div className="flex items-center justify-between pt-2">
              <InfoRow label="Display name" value={user.displayName} />
              <button
                onClick={() => {
                  setNewDisplayName(user.displayName);
                  setNewProfilePictureUrl(user.profilePictureUrl ?? "");
                  setEditingProfile(true);
                }}
                className="btn-press text-sm text-nus-blue hover:underline"
              >
                Edit
              </button>
            </div>
          )}

          {profileMsg && (
            <p className="text-sm text-nus-orange fade-in">{profileMsg}</p>
          )}
        </div>
      </div>

      {/* Roles card */}
      <div className="rounded-2xl border border-border bg-surface p-6 mb-6 shadow-sm">
        <h3 className="text-lg font-semibold mb-2">Errand Roles</h3>
        <p className="text-sm text-muted mb-4">
          Choose how you want to participate on the platform.
        </p>
        <div className="flex gap-3 mb-4">
          {["requester", "courier"].map((role) => (
            <button
              key={role}
              onClick={() => toggleRole(role)}
              className={`btn-press flex-1 rounded-xl border-2 px-4 py-3 text-sm font-medium transition-all ${
                selectedRoles.includes(role)
                  ? "border-nus-orange bg-nus-orange/10 text-nus-orange"
                  : "border-border text-muted hover:border-nus-orange/50"
              }`}
            >
              <div className="font-semibold capitalize">{role}</div>
              <div className="text-xs mt-1 opacity-70">
                {role === "requester"
                  ? "Request errands"
                  : "Fulfill errands"}
              </div>
            </button>
          ))}
        </div>
        <button
          onClick={handleRoleUpdate}
          className="btn-press rounded-xl bg-nus-blue px-4 py-2 text-sm font-semibold text-white hover:bg-nus-blue-light transition-colors"
        >
          Update roles
        </button>
        {roleMsg && <p className="text-sm text-nus-orange mt-2 fade-in">{roleMsg}</p>}
      </div>

      {/* Password reset */}
      <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm">
        <h3 className="text-lg font-semibold mb-2">Security</h3>
        <p className="text-sm text-muted mb-4">
          Manage your password and account security.
        </p>
        <Link
          href="/forgot-password"
          className="btn-press inline-block rounded-xl border border-border px-4 py-2 text-sm font-medium hover:bg-background transition-colors"
        >
          Reset password
        </Link>
      </div>
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
    <section
      aria-labelledby="credit-balance-heading"
      className="rounded-2xl border border-border bg-surface p-6 mb-6 shadow-sm"
    >
      <h3 id="credit-balance-heading" className="text-lg font-semibold mb-4">
        Credit Balance
      </h3>

      {status === "loading" && (
        <p role="status" className="text-sm text-muted">
          Loading credit balance...
        </p>
      )}

      {status === "ready" && balance && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <BalanceValue
            label="Available credits"
            value={balance.creditBalance}
          />
          <BalanceValue
            label="Reserved credits"
            value={balance.reservedBalance}
          />
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
    </section>
  );
}

function BalanceValue({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-background p-4">
      <span className="block text-sm text-muted">{label}</span>
      <span className="mt-1 block text-2xl font-bold text-foreground">
        {value.toLocaleString()}
      </span>
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
      <button
        type="button"
        onClick={() => void onRetry()}
        className="btn-press rounded-xl border border-border px-3 py-1.5 text-sm font-medium hover:bg-background transition-colors"
      >
        Retry
      </button>
    </div>
  );
}
