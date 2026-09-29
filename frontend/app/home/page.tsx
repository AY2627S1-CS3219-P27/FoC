"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

interface UserProfile {
  uuid: string;
  email: string;
  displayName: string;
  profilePictureUrl: string | null;
  roles: string[];
  isAdmin: boolean;
}

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
  locationDescription: string;
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

type Tab = "suppliers" | "profile";

export default function HomePage() {
  const router = useRouter();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [userLoading, setUserLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("suppliers");

  // Supplier state
  const [suppliers, setSuppliers] = useState<SupplierItem[]>([]);
  const [buildings, setBuildings] = useState<BuildingItem[]>([]);
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [suppliersLoading, setSuppliersLoading] = useState(true);
  const [searchName, setSearchName] = useState("");
  const [filterBuilding, setFilterBuilding] = useState("");
  const [filterKind, setFilterKind] = useState("");
  const [selectedSupplier, setSelectedSupplier] = useState<string | null>(null);

  // Profile edit state
  const [editingProfile, setEditingProfile] = useState(false);
  const [newDisplayName, setNewDisplayName] = useState("");
  const [profileMsg, setProfileMsg] = useState("");

  // Role state
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [roleMsg, setRoleMsg] = useState("");

  useEffect(() => {
    fetch("/api/users/me")
      .then((res) => {
        if (!res.ok) throw new Error("Not authenticated");
        return res.json();
      })
      .then((data: UserProfile) => {
        setUser(data);
        setSelectedRoles(data.roles);
      })
      .catch(() => router.push("/login"))
      .finally(() => setUserLoading(false));
  }, [router]);

  const loadSuppliers = useCallback(async () => {
    setSuppliersLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("status", "Active");
      if (searchName) params.set("name", searchName);
      if (filterBuilding) params.set("buildingId", filterBuilding);
      if (filterKind) params.set("kind", filterKind);
      const res = await fetch(`/api/suppliers?${params}`);
      if (res.ok) {
        const data = await res.json();
        setSuppliers(data.items);
      }
    } catch {
      /* supplier service might not be running */
    }
    setSuppliersLoading(false);
  }, [searchName, filterBuilding, filterKind]);

  useEffect(() => {
    loadSuppliers();
  }, [loadSuppliers]);

  useEffect(() => {
    Promise.all([
      fetch("/api/buildings")
        .then((r) => r.json())
        .catch(() => ({ items: [] })),
      fetch("/api/categories")
        .then((r) => r.json())
        .catch(() => ({ items: [] })),
    ]).then(([b, c]) => {
      setBuildings(b.items ?? []);
      setCategories(c.items ?? []);
    });
  }, []);

  async function handleProfileUpdate(e: React.FormEvent) {
    e.preventDefault();
    setProfileMsg("");
    const res = await fetch("/api/users/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: newDisplayName }),
    });
    if (res.ok) {
      const updated = await res.json();
      setUser((prev) => (prev ? { ...prev, ...updated } : prev));
      setEditingProfile(false);
      setProfileMsg("Profile updated. You may need to log in again.");
    } else {
      setProfileMsg("Failed to update profile.");
    }
  }

  async function handleRoleUpdate() {
    setRoleMsg("");
    const res = await fetch("/api/users/me/roles", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roles: selectedRoles }),
    });
    if (res.ok) {
      setRoleMsg(
        "Roles updated. Please log in again to refresh your session."
      );
    } else {
      setRoleMsg("Failed to update roles.");
    }
  }

  function toggleRole(role: string) {
    setSelectedRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]
    );
  }

  if (userLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-muted">Loading...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-full">
      {/* Navigation */}
      <header className="bg-nus-blue text-white">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/home" className="text-xl font-bold tracking-tight">
              FoC
            </Link>
            <nav className="hidden sm:flex gap-1">
              <button
                onClick={() => setTab("suppliers")}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  tab === "suppliers"
                    ? "bg-white/20 text-white"
                    : "text-white/70 hover:text-white hover:bg-white/10"
                }`}
              >
                Suppliers
              </button>
              <button
                onClick={() => setTab("profile")}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  tab === "profile"
                    ? "bg-white/20 text-white"
                    : "text-white/70 hover:text-white hover:bg-white/10"
                }`}
              >
                My Account
              </button>
            </nav>
          </div>
          <div className="flex items-center gap-3">
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
              className="text-sm text-white/70 hover:text-white"
            >
              Sign out
            </Link>
          </div>
        </div>
        {/* Mobile tabs */}
        <div className="sm:hidden flex border-t border-white/20">
          <button
            onClick={() => setTab("suppliers")}
            className={`flex-1 py-2 text-sm font-medium ${tab === "suppliers" ? "bg-white/20" : "text-white/70"}`}
          >
            Suppliers
          </button>
          <button
            onClick={() => setTab("profile")}
            className={`flex-1 py-2 text-sm font-medium ${tab === "profile" ? "bg-white/20" : "text-white/70"}`}
          >
            My Account
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-6">
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
          />
        )}

        {tab === "profile" && user && (
          <ProfileTab
            user={user}
            editingProfile={editingProfile}
            setEditingProfile={setEditingProfile}
            newDisplayName={newDisplayName}
            setNewDisplayName={setNewDisplayName}
            profileMsg={profileMsg}
            handleProfileUpdate={handleProfileUpdate}
            selectedRoles={selectedRoles}
            toggleRole={toggleRole}
            handleRoleUpdate={handleRoleUpdate}
            roleMsg={roleMsg}
          />
        )}
      </main>
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
          placeholder="Search by name..."
          value={searchName}
          onChange={(e) => setSearchName(e.target.value)}
          className="flex-1 min-w-[200px] rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-nus-orange"
        />
        <select
          value={filterBuilding}
          onChange={(e) => setFilterBuilding(e.target.value)}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-nus-orange"
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
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-nus-orange"
        >
          <option value="">All types</option>
          <option value="Store">Store</option>
          <option value="Facility">Facility</option>
          <option value="Landmark">Landmark</option>
        </select>
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted">
          Loading suppliers...
        </div>
      ) : suppliers.length === 0 ? (
        <div className="text-center py-12">
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
              className={`text-left rounded-xl border p-4 transition-all hover:shadow-md ${
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
              <p className="text-sm text-muted mb-2">
                Floor {supplier.floor} · {supplier.locationDescription}
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

      {/* Supplier detail drawer */}
      {selected && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30">
          <div className="w-full max-w-md bg-background border-l border-border overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold">{selected.displayName}</h3>
                <button
                  onClick={() => setSelectedSupplier(null)}
                  className="text-muted hover:text-foreground text-2xl leading-none"
                >
                  &times;
                </button>
              </div>

              <div className="space-y-4">
                <InfoRow label="Type" value={selected.kind} />
                <InfoRow
                  label="Building"
                  value={selected.building?.shortName ?? "—"}
                />
                <InfoRow label="Floor" value={selected.floor} />
                <InfoRow
                  label="Location"
                  value={selected.locationDescription}
                />
                <InfoRow
                  label="Status"
                  value={
                    <span
                      className={
                        selected.status === "Active"
                          ? "text-success"
                          : "text-danger"
                      }
                    >
                      {selected.status}
                    </span>
                  }
                />
                <div>
                  <span className="text-sm text-muted block mb-1">
                    Categories
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {selected.categories.map((cat) => (
                      <span
                        key={cat.id}
                        className="text-sm bg-nus-orange/10 text-nus-orange px-2.5 py-1 rounded-full"
                      >
                        {cat.name}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
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

function ProfileTab({
  user,
  editingProfile,
  setEditingProfile,
  newDisplayName,
  setNewDisplayName,
  profileMsg,
  handleProfileUpdate,
  selectedRoles,
  toggleRole,
  handleRoleUpdate,
  roleMsg,
}: {
  user: UserProfile;
  editingProfile: boolean;
  setEditingProfile: (v: boolean) => void;
  newDisplayName: string;
  setNewDisplayName: (v: string) => void;
  profileMsg: string;
  handleProfileUpdate: (e: React.FormEvent) => void;
  selectedRoles: string[];
  toggleRole: (role: string) => void;
  handleRoleUpdate: () => void;
  roleMsg: string;
}) {
  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl font-bold mb-6">My Account</h2>

      {/* Profile card */}
      <div className="rounded-xl border border-border bg-surface p-6 mb-6">
        <h3 className="text-lg font-semibold mb-4">Profile</h3>
        <div className="space-y-3">
          <InfoRow label="Email" value={user.email} />
          <InfoRow label="User ID" value={user.uuid} />

          {editingProfile ? (
            <form onSubmit={handleProfileUpdate} className="space-y-3 pt-2">
              <div>
                <label className="block text-sm font-medium mb-1">
                  Display name
                </label>
                <input
                  value={newDisplayName}
                  onChange={(e) => setNewDisplayName(e.target.value)}
                  required
                  maxLength={255}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-nus-orange"
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  className="rounded-lg bg-nus-orange px-4 py-2 text-sm font-semibold text-white hover:bg-nus-orange-hover"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setEditingProfile(false)}
                  className="rounded-lg border border-border px-4 py-2 text-sm"
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
                  setEditingProfile(true);
                }}
                className="text-sm text-nus-blue hover:underline"
              >
                Edit
              </button>
            </div>
          )}

          {profileMsg && (
            <p className="text-sm text-nus-orange">{profileMsg}</p>
          )}
        </div>
      </div>

      {/* Roles card */}
      <div className="rounded-xl border border-border bg-surface p-6 mb-6">
        <h3 className="text-lg font-semibold mb-2">Errand Roles</h3>
        <p className="text-sm text-muted mb-4">
          Choose how you want to participate on the platform.
        </p>
        <div className="flex gap-3 mb-4">
          {["requester", "courier"].map((role) => (
            <button
              key={role}
              onClick={() => toggleRole(role)}
              className={`flex-1 rounded-lg border-2 px-4 py-3 text-sm font-medium transition-all ${
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
          className="rounded-lg bg-nus-blue px-4 py-2 text-sm font-semibold text-white hover:bg-nus-blue-light"
        >
          Update roles
        </button>
        {roleMsg && <p className="text-sm text-nus-orange mt-2">{roleMsg}</p>}
      </div>

      {/* Password reset */}
      <div className="rounded-xl border border-border bg-surface p-6">
        <h3 className="text-lg font-semibold mb-2">Security</h3>
        <p className="text-sm text-muted mb-4">
          Manage your password and account security.
        </p>
        <Link
          href="/forgot-password"
          className="inline-block rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-background transition-colors"
        >
          Reset password
        </Link>
      </div>
    </div>
  );
}
