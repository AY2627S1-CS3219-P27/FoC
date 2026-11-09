"use client";

import NumberFlow from "@number-flow/react";
import { clsx } from "clsx";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api, errorText, type ApiResult } from "@/lib/api";
import { fetchFirst } from "@/lib/paging";
import { Button } from "@/components/ui/button";
import { FilterSelect } from "@/components/ui/field";
import { BoxIcon, ChevronRightIcon, PlusIcon } from "@/components/ui/icons";
import { EmptyState, IconTile, LoadMore, PageHeader, SkeletonList } from "@/components/ui/layout";
import { Segmented } from "@/components/ui/segmented";
import { Sheet } from "@/components/ui/sheet";
import { CreateErrandForm } from "./create-errand-form";
import { ErrandDetail } from "./errand-detail";
import {
  ERRAND_STATUSES,
  formatDelivery,
  type BuildingOption,
  type Errand,
  type Page,
  type SupplierOption,
} from "./types";
import { formatCredits, statusColor, StatusBadge, timeLeft } from "./ui";

const POLL_MS = 5000;
const PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50; // order-service caps limit at 50

type View = "browse" | "mine";

const VIEWS = [
  ["browse", "Open errands"],
  ["mine", "My errands"],
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
  const [creating, setCreating] = useState(false);
  // A new errand opens its detail sheet once the compose sheet has finished closing.
  const openAfterCreate = useRef<string | null>(null);

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

  const loadList = useCallback(async () => {
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
      setListError(res ? errorText(res, "Could not load errands.") : "Could not load errands.");
    }
  }, [view, pickupBuilding, deliveryBuilding, minCredits, sort, mineRole, mineStatus, count]);

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
  const canRequest = roles.includes("requester");

  return (
    <div>
      <PageHeader
        title="Errands"
        subtitle={<>You&rsquo;re a {roles.join(" and ")}</>}
        actions={
          canRequest && (
            <Button size="sm" onClick={() => setCreating(true)}>
              <PlusIcon size={15} strokeWidth={2.5} />
              New errand
            </Button>
          )
        }
      />

      {/* Side by side only when both full amounts fit; phones stack them rather than cut a number. */}
      <section aria-label="Credits" className="mb-6 grid grid-cols-1 overflow-hidden rounded-2xl bg-surface sm:grid-cols-2">
        <BalanceCell label="Available" value={balance?.creditBalance} accent />
        <BalanceCell label="Reserved" value={balance?.reservedBalance} />
      </section>

      <Segmented
        label="Errand views"
        className="mb-4 w-full sm:w-auto"
        value={view}
        items={VIEWS}
        onChange={(v) => {
          setLoading(true);
          setView(v);
        }}
      />

      {/* Filters scroll sideways on phones instead of wrapping into a wall. */}
      <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:flex-wrap md:px-0">
        {view === "browse" ? (
          <>
            <FilterSelect
              label="Pickup building"
              value={pickupBuilding}
              onValueChange={setPickupBuilding}
              options={[{ value: "", label: "Any pickup" }, ...buildings.map((b) => ({ value: b.shortName, label: `Pickup: ${b.shortName}` }))]}
            />
            <FilterSelect
              label="Delivery building"
              value={deliveryBuilding}
              onValueChange={setDeliveryBuilding}
              options={[{ value: "", label: "Any delivery" }, ...buildings.map((b) => ({ value: b.shortName, label: `Deliver: ${b.shortName}` }))]}
            />
            <input
              type="number"
              min={1}
              placeholder="Min credits"
              aria-label="Minimum credits"
              value={minCredits}
              onChange={(e) => setMinCredits(e.target.value)}
              className="h-9 w-28 shrink-0 rounded-full border-0 bg-surface px-3.5 text-[13px] font-medium shadow-raised placeholder:text-muted"
            />
            <FilterSelect
              label="Sort by"
              value={sort}
              onValueChange={setSort}
              options={[
                { value: "expiring", label: "Expiring soonest" },
                { value: "newest", label: "Newest" },
                { value: "credits", label: "Highest credits" },
              ]}
            />
          </>
        ) : (
          <>
            <FilterSelect
              label="Role"
              value={mineRole}
              onValueChange={setMineRole}
              options={[
                { value: "", label: "Requests and deliveries" },
                { value: "requester", label: "My requests" },
                { value: "courier", label: "My deliveries" },
              ]}
            />
            <FilterSelect
              label="Status"
              value={mineStatus}
              onValueChange={setMineStatus}
              options={[{ value: "", label: "Any status" }, ...ERRAND_STATUSES.map((s) => ({ value: s, label: s }))]}
            />
          </>
        )}
      </div>

      {loading ? (
        <SkeletonList />
      ) : listError ? (
        <EmptyState tone="error" title="Couldn't load errands" body={listError} />
      ) : items.length === 0 ? (
        <EmptyState
          title={view === "browse" ? "No open errands" : "No errands yet"}
          body={
            view === "browse"
              ? "New requests show up here on their own. Try widening your filters."
              : "Errands you request or deliver will be listed here."
          }
          action={
            view === "mine" &&
            canRequest && (
              <Button intent="tinted" size="sm" onClick={() => setCreating(true)}>
                New errand
              </Button>
            )
          }
        />
      ) : (
        <>
          <ul className="stagger overflow-hidden rounded-2xl bg-surface [&>li+li_.row-content]:border-t">
            {items.map((e) => (
              <ErrandRow
                key={e.id}
                errand={e}
                title={e.pickupName ?? supplierName(e.supplierId)}
                meta={
                  view === "mine"
                    ? e.requesterId === me
                      ? "You requested"
                      : "You deliver"
                    : timeLeft(e.expiresAt)
                }
                onOpen={() => setSelected(e.id)}
              />
            ))}
          </ul>
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
      )}

      {creating && (
        <Sheet
          title="New errand"
          onClose={() => {
            setCreating(false);
            const id = openAfterCreate.current;
            openAfterCreate.current = null;
            if (id) setSelected(id);
          }}
        >
          {(close) => (
            <CreateErrandForm
              userId={me}
              suppliers={suppliers}
              buildings={buildings}
              onCreated={(id) => {
                toast.success("Errand created", {
                  description: "It opens to couriers once the supplier and credits are confirmed.",
                });
                openAfterCreate.current = id;
                setView("mine");
                refresh();
                close();
              }}
            />
          )}
        </Sheet>
      )}

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

function BalanceCell({ label, value, accent = false }: { label: string; value: number | undefined; accent?: boolean }) {
  return (
    <div className="min-w-0 border-border px-4 py-3.5 first:border-b sm:first:border-r sm:first:border-b-0">
      <p className="text-[13px] text-muted">{label}</p>
      <p className={clsx("tabular mt-0.5 text-[22px] font-semibold tracking-tight [overflow-wrap:anywhere]", accent && "text-nus-orange")}>
        {value === undefined ? "—" : <NumberFlow value={value} />}
      </p>
    </div>
  );
}

function ErrandRow({
  errand,
  title,
  meta,
  onOpen,
}: {
  errand: Errand;
  title: string;
  meta: string;
  onOpen: () => void;
}) {
  return (
    <li>
      <button type="button" onClick={onOpen} className="row-press flex w-full items-start pl-4 text-left">
        <span className="pt-3">
          <IconTile color={statusColor(errand.status)}>
            <BoxIcon size={17} strokeWidth={2} />
          </IconTile>
        </span>
        <span className="row-content ml-3 flex min-w-0 flex-1 items-center gap-2 border-border py-3 pr-3">
          {/* Title gets the full width; the reward sits at the end of the status line so it never squeezes the title. */}
          <span className="min-w-0 flex-1">
            <span className="line-clamp-2 text-[15px] font-semibold break-words">{title}</span>
            <span className="mt-0.5 flex items-start justify-between gap-3 text-[13px] text-muted">
              {/* The route wraps to a second line instead of cutting the pickup building short. */}
              <span className="line-clamp-2 min-w-0 break-words">
                {errand.pickupLocation ?? "—"} → {formatDelivery(errand)}
              </span>
              <span className="shrink-0">{meta}</span>
            </span>
            {/* When a large reward can't fit beside the badge, it drops to its own line rather than being cut. */}
            <span className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <StatusBadge status={errand.status} />
              <span className="min-w-16 flex-1 truncate text-[13px] text-muted">{errand.collectionItems}</span>
              <span className="tabular ml-auto shrink-0 text-[15px] font-semibold text-nus-orange">
                {formatCredits(errand.rewardCredits)}
              </span>
            </span>
          </span>
          <ChevronRightIcon size={14} strokeWidth={2.5} className="shrink-0 text-muted/60" />
        </span>
      </button>
    </li>
  );
}
