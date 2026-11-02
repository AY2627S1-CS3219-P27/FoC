"use client";

import NumberFlow from "@number-flow/react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api, type ApiResult } from "@/lib/api";
import { fetchFirst } from "@/lib/paging";
import { ArrowRightIcon, ClockIcon } from "@/components/ui/icons";
import { EmptyState, LoadMore, PageHeader, SkeletonGrid } from "@/components/ui/layout";
import { Segmented } from "@/components/ui/segmented";
import { CreateErrandForm } from "./create-errand-form";
import { ErrandDetail } from "./errand-detail";
import {
  ERRAND_STATUSES,
  type BuildingOption,
  type Errand,
  type Page,
  type SupplierOption,
} from "./types";
import { formatCredits, inputClass, StatusBadge, timeLeft } from "./ui";

const POLL_MS = 5000;
const PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50; // order-service caps limit at 50

type View = "browse" | "mine" | "new";

const VIEWS = [
  ["browse", "Open errands"],
  ["mine", "My errands"],
  ["new", "New errand"],
] as const;

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
    const res = await api<Balance>("GET", "/api/credits/balance");
    if (res.ok) setBalance(res.data);
  }, []);

  // "Load more" grows this; changing the view or a filter starts again from one page.
  const listKey = JSON.stringify([view, pickupBuilding, deliveryBuilding, minCredits, sort, mineRole, mineStatus]);
  const [paging, setPaging] = useState({ key: listKey, count: PAGE_SIZE });
  const count = paging.key === listKey ? paging.count : PAGE_SIZE;
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadList = useCallback(
    async () => {
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
      let failed: ApiResult | null = null;
      const loaded = await fetchFirst(count, MAX_PAGE_SIZE, async (offset, limit) => {
        params.set("offset", String(offset));
        params.set("limit", String(limit));
        const res = await api<Page<Errand>>("GET", `${path}?${params}`);
        if (res.ok && res.data) return res.data;
        failed = res;
        return null;
      });
      setLoading(false);
      setLoadingMore(false);
      if (loaded) {
        setItems(loaded.items);
        setHasMore(loaded.hasMore);
        setListError("");
      } else {
        const res = failed as ApiResult | null;
        setItems([]);
        setHasMore(false);
        setListError(`${res?.status} ${res?.code ?? ""}: ${res?.message ?? "Could not load errands."}`);
      }
    },
    [view, pickupBuilding, deliveryBuilding, minCredits, sort, mineRole, mineStatus, count],
  );

  useEffect(() => {
    const first = setTimeout(() => {
      void loadList();
      void loadBalance();
    }, 0);
    const timer = setInterval(() => {
      void loadList();
      void loadBalance();
    }, POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [loadList, loadBalance]);

  useEffect(() => {
    // Every active supplier, so the pickup picker is never cut off at one page.
    void fetchFirst(Infinity, 1000, async (offset, limit) => {
      const res = await api<{ items: SupplierOption[]; total: number }>(
        "GET",
        `/api/suppliers?status=Active&offset=${offset}&limit=${limit}`,
      );
      return res.data;
    }).then((loaded) => setSuppliers(loaded?.items ?? []));
  }, []);

  const refresh = () => {
    void loadList();
    void loadBalance();
  };

  const supplierName = (id: string) => suppliers.find((s) => s.id === id)?.displayName ?? "Unknown supplier";

  return (
    <div>
      <PageHeader
        title="Errands"
        subtitle={<>Signed in as {roles.join(" and ")}</>}
        actions={
          <>
            <BalanceChip label="Available" value={balance?.creditBalance} />
            <BalanceChip label="Reserved" value={balance?.reservedBalance} />
          </>
        }
      />

      <div className="mb-5">
        <Segmented
          label="Errand views"
          className="w-full sm:w-auto"
          value={view}
          items={VIEWS}
          onChange={(v) => {
            setLoading(true);
            setView(v);
          }}
        />
      </div>

      {view === "new" && (
        <CreateErrandForm
          userId={me}
          suppliers={suppliers}
          buildings={buildings}
          onCreated={(id) => {
            toast.success("Errand created", {
              description: "It opens to couriers once the supplier and credits are confirmed.",
            });
            setSelected(id);
            setView("mine");
            refresh();
          }}
        />
      )}

      {view === "browse" && (
        <div className="mb-5 grid gap-3 sm:flex sm:flex-wrap">
          <select value={pickupBuilding} onChange={(e) => setPickupBuilding(e.target.value)} className={inputClass} aria-label="Pickup building">
            <option value="">Any pickup building</option>
            {buildings.map((b) => (
              <option key={b.id} value={b.shortName}>
                Pickup: {b.shortName}
              </option>
            ))}
          </select>
          <select value={deliveryBuilding} onChange={(e) => setDeliveryBuilding(e.target.value)} className={inputClass} aria-label="Delivery building">
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
            aria-label="Minimum credits"
            value={minCredits}
            onChange={(e) => setMinCredits(e.target.value)}
            className={`sm:w-32 ${inputClass}`}
          />
          <select value={sort} onChange={(e) => setSort(e.target.value)} className={inputClass} aria-label="Sort by">
            <option value="expiring">Expiring soonest</option>
            <option value="newest">Newest</option>
            <option value="credits">Highest credits</option>
          </select>
        </div>
      )}

      {view === "mine" && (
        <div className="mb-5 grid gap-3 sm:flex sm:flex-wrap">
          <select value={mineRole} onChange={(e) => setMineRole(e.target.value)} className={inputClass} aria-label="Role">
            <option value="">As requester or courier</option>
            <option value="requester">My requests</option>
            <option value="courier">My deliveries</option>
          </select>
          <select value={mineStatus} onChange={(e) => setMineStatus(e.target.value)} className={inputClass} aria-label="Status">
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
          <SkeletonGrid />
        ) : listError ? (
          <EmptyState tone="error" title="Could not load errands" body={listError} />
        ) : items.length === 0 ? (
          <EmptyState
            title={view === "browse" ? "No open errands right now" : "No errands here yet"}
            body={
              view === "browse"
                ? "New requests show up here on their own. Try widening your filters."
                : "Errands you request or deliver will be listed here."
            }
          />
        ) : (
          <>
            <div className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((e) => (
                <ErrandCard
                  key={e.id}
                  errand={e}
                  title={e.pickupName ?? supplierName(e.supplierId)}
                  footer={
                    view === "mine"
                      ? e.requesterId === me
                        ? "You requested"
                        : "You deliver"
                      : timeLeft(e.expiresAt)
                  }
                  onOpen={() => setSelected(e.id)}
                />
              ))}
            </div>
            <LoadMore
              noun="errands"
              shown={items.length}
              total={null}
              hasMore={hasMore}
              loading={loadingMore}
              onLoadMore={() => {
                setLoadingMore(true);
                setPaging({ key: listKey, count: count + PAGE_SIZE });
              }}
            />
          </>
        ))}

      {selected && (
        <ErrandDetail
          key={selected}
          errandId={selected}
          me={me}
          suppliers={suppliers}
          onChanged={refresh}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function BalanceChip({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="flex items-baseline gap-1.5 rounded-xl border border-border bg-surface px-3 py-2 text-sm">
      <span className="text-muted">{label}</span>
      {value === undefined ? (
        <span className="font-semibold">—</span>
      ) : (
        <NumberFlow value={value} className="tabular font-semibold" />
      )}
    </div>
  );
}

function ErrandCard({
  errand,
  title,
  footer,
  onOpen,
}: {
  errand: Errand;
  title: string;
  footer: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="card-press flex min-w-0 flex-col rounded-2xl border border-border bg-surface p-4 text-left shadow-card"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <h3 className="min-w-0 font-semibold break-words line-clamp-2">{title}</h3>
        <StatusBadge status={errand.status} />
      </div>
      <p className="mb-2 flex min-w-0 items-center gap-1.5 text-sm text-muted">
        {/* A building short name (at most 20 characters) stays whole; the free-text delivery spot truncates. */}
        <span className="max-w-[60%] shrink-0 truncate">{errand.pickupLocation ?? "—"}</span>
        <ArrowRightIcon size={14} className="shrink-0" />
        <span className="truncate">{errand.deliveryLocation}</span>
      </p>
      <p className="mb-4 text-sm break-words line-clamp-2">{errand.collectionItems}</p>
      <div className="mt-auto flex items-center justify-between gap-3 border-t border-border pt-3 text-sm">
        <span className="tabular truncate font-semibold text-nus-orange">
          {formatCredits(errand.rewardCredits)}
        </span>
        <span className="flex shrink-0 items-center gap-1 text-muted">
          <ClockIcon size={14} />
          {footer}
        </span>
      </div>
    </button>
  );
}
