"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { CreateErrandForm } from "./create-errand-form";
import { ErrandDetail } from "./errand-detail";
import {
  ERRAND_STATUSES,
  type BuildingOption,
  type Errand,
  type Page,
  type SupplierOption,
} from "./types";
import { inputClass, StatusBadge, timeLeft } from "./ui";

const POLL_MS = 5000;

type View = "browse" | "mine" | "new";

interface Balance {
  creditBalance: number;
  reservedBalance: number;
}

export function ErrandsTab({
  me,
  roles,
  buildings,
}: {
  me: string;
  roles: string[];
  buildings: BuildingOption[];
}) {
  const [view, setView] = useState<View>(roles.includes("courier") ? "browse" : "mine");
  const [showAllActions, setShowAllActions] = useState(false);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [items, setItems] = useState<Errand[]>([]);
  const [listError, setListError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  const [pickupBuilding, setPickupBuilding] = useState("");
  const [deliveryBuilding, setDeliveryBuilding] = useState("");
  const [minCredits, setMinCredits] = useState("");
  const [sort, setSort] = useState("expiring");
  const [mineRole, setMineRole] = useState("");
  const [mineStatus, setMineStatus] = useState("");

  const loadBalance = useCallback(async () => {
    const res = await api<Balance>("GET", "/api/credits/balance", { quiet: true });
    if (res.ok) setBalance(res.data);
  }, []);

  const loadList = useCallback(
    async (quiet: boolean) => {
      if (view === "new") return;
      const params = new URLSearchParams();
      if (view === "browse") {
        if (pickupBuilding) params.set("pickupBuilding", pickupBuilding);
        if (deliveryBuilding) params.set("deliveryBuilding", deliveryBuilding);
        if (minCredits) params.set("minCredits", minCredits);
        params.set("sort", sort);
      } else {
        if (mineRole) params.set("role", mineRole);
        if (mineStatus) params.set("status", mineStatus);
      }
      const path = view === "browse" ? "/api/errands" : "/api/errands/mine";
      const res = await api<Page<Errand>>("GET", `${path}?${params}`, { quiet });
      setLoading(false);
      if (res.ok && res.data) {
        setItems(res.data.items);
        setListError("");
      } else {
        setItems([]);
        setListError(`${res.status} ${res.code ?? ""}: ${res.message ?? "Could not load errands."}`);
      }
    },
    [view, pickupBuilding, deliveryBuilding, minCredits, sort, mineRole, mineStatus],
  );

  useEffect(() => {
    const first = setTimeout(() => {
      void loadList(false);
      void loadBalance();
    }, 0);
    const timer = setInterval(() => {
      void loadList(true);
      void loadBalance();
    }, POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [loadList, loadBalance]);

  useEffect(() => {
    api<Page<SupplierOption>>("GET", "/api/suppliers?status=Active&limit=100", { quiet: true }).then(
      (res) => setSuppliers(res.data?.items ?? []),
    );
  }, []);

  const refresh = () => {
    void loadList(true);
    void loadBalance();
  };

  const supplierName = (id: string) => suppliers.find((s) => s.id === id)?.displayName ?? "Supplier";

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold mb-1">Errands</h2>
          <p className="text-muted text-sm">
            Your roles: {roles.length ? roles.join(", ") : "none"}
          </p>
        </div>
        <div className="flex gap-3 text-sm">
          <div className="rounded-xl bg-surface border border-border px-3 py-2">
            <span className="text-muted">Available </span>
            <span className="font-bold">{balance?.creditBalance ?? "—"}</span>
          </div>
          <div className="rounded-xl bg-surface border border-border px-3 py-2">
            <span className="text-muted">Reserved </span>
            <span className="font-bold">{balance?.reservedBalance ?? "—"}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex gap-1 rounded-xl bg-surface border border-border p-1">
          {(
            [
              ["browse", "Open errands"],
              ["mine", "My errands"],
              ["new", "New errand"],
            ] as [View, string][]
          ).map(([v, label]) => (
            <button
              key={v}
              onClick={() => {
                setLoading(true);
                setView(v);
              }}
              className={`btn-press px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                view === v ? "bg-nus-orange text-white" : "text-muted hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={showAllActions}
            onChange={(e) => setShowAllActions(e.target.checked)}
          />
          Demo: show all actions (the backend decides)
        </label>
      </div>

      {view === "new" && (
        <CreateErrandForm
          suppliers={suppliers}
          buildings={buildings}
          onCreated={(id) => {
            setSelected(id);
            setView("mine");
            refresh();
          }}
        />
      )}

      {view === "browse" && (
        <div className="flex flex-wrap gap-3 mb-5">
          <select value={pickupBuilding} onChange={(e) => setPickupBuilding(e.target.value)} className={inputClass}>
            <option value="">Any pickup building</option>
            {buildings.map((b) => (
              <option key={b.id} value={b.shortName}>
                Pickup: {b.shortName}
              </option>
            ))}
          </select>
          <select value={deliveryBuilding} onChange={(e) => setDeliveryBuilding(e.target.value)} className={inputClass}>
            <option value="">Any delivery building</option>
            {buildings.map((b) => (
              <option key={b.id} value={b.shortName}>
                Deliver: {b.shortName}
              </option>
            ))}
          </select>
          <input
            type="number"
            min={1}
            placeholder="Min credits"
            value={minCredits}
            onChange={(e) => setMinCredits(e.target.value)}
            className={`w-32 ${inputClass}`}
          />
          <select value={sort} onChange={(e) => setSort(e.target.value)} className={inputClass}>
            <option value="expiring">Expiring soonest</option>
            <option value="newest">Newest</option>
            <option value="credits">Highest credits</option>
          </select>
        </div>
      )}

      {view === "mine" && (
        <div className="flex flex-wrap gap-3 mb-5">
          <select value={mineRole} onChange={(e) => setMineRole(e.target.value)} className={inputClass}>
            <option value="">As requester or courier</option>
            <option value="requester">My requests</option>
            <option value="courier">My deliveries</option>
          </select>
          <select value={mineStatus} onChange={(e) => setMineStatus(e.target.value)} className={inputClass}>
            <option value="">Any status</option>
            {ERRAND_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      )}

      {view !== "new" &&
        (loading ? (
          <p className="text-center py-12 text-muted">Loading errands…</p>
        ) : listError ? (
          <p role="alert" className="text-center py-12 text-danger text-sm">
            {listError}
          </p>
        ) : items.length === 0 ? (
          <p className="text-center py-12 text-muted">No errands here yet.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((e) => (
              <button
                key={e.id}
                onClick={() => setSelected(e.id)}
                className="card-press text-left rounded-2xl border border-border bg-surface p-4 hover:border-nus-orange/50 hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <h3 className="font-semibold">{e.pickupName ?? supplierName(e.supplierId)}</h3>
                  <StatusBadge status={e.status} />
                </div>
                <p className="text-sm text-muted mb-1">
                  {e.pickupLocation ?? "—"} → {e.deliveryLocation}
                </p>
                <p className="text-sm line-clamp-2 mb-2">{e.collectionItems}</p>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold text-nus-orange">{e.rewardCredits} credits</span>
                  <span className="text-muted">
                    {view === "mine"
                      ? e.requesterId === me
                        ? "You requested"
                        : "You deliver"
                      : timeLeft(e.expiresAt)}
                  </span>
                </div>
              </button>
            ))}
          </div>
        ))}

      {selected && (
        <ErrandDetail
          key={selected}
          errandId={selected}
          me={me}
          suppliers={suppliers}
          showAllActions={showAllActions}
          onChanged={refresh}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
