"use client";

import { useCallback, useEffect, useState } from "react";
import { api, errorText, type ApiResult } from "@/lib/api";
import { fetchFirst } from "@/lib/paging";
import { FlagIcon } from "@/components/ui/icons";
import { EmptyState, IconTile, List, ListRow, LoadMore, PageHeader, Pill, SkeletonList } from "@/components/ui/layout";
import type { Page } from "../_errands/types";
import { formatCredits, formatTime, shortId } from "../_errands/ui";
import { DisputeDetail } from "./dispute-detail";
import type { DisputeSummary } from "./types";

const POLL_MS = 10000;
const PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

// Admin queue: errands stuck in Incomplete (including mid-settlement), longest-disputed first.
export function DisputesTab() {
  const [items, setItems] = useState<DisputeSummary[]>([]);
  const [count, setCount] = useState(PAGE_SIZE);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    let failed: ApiResult | null = null;
    const loaded = await fetchFirst<DisputeSummary>(count, MAX_PAGE_SIZE, async (offset, limit) => {
      const res = await api<Page<DisputeSummary>>("GET", `/api/admin/disputes?offset=${offset}&limit=${limit}`);
      if (res.ok && res.data) return res.data;
      failed = res;
      return null;
    });
    setLoading(false);
    if (loaded) {
      setItems(loaded.items);
      setHasMore(loaded.hasMore);
      setError("");
    } else {
      const res = failed as ApiResult | null;
      setItems([]);
      setHasMore(false);
      setError(res ? errorText(res, "Could not load disputes.") : "Could not load disputes.");
    }
  }, [count]);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);

  return (
    <div>
      <PageHeader title="Disputes" subtitle="Incomplete errands waiting for a settlement, longest first." />

      {loading ? (
        <SkeletonList />
      ) : error ? (
        <EmptyState tone="error" title="Couldn't load disputes" body={error} />
      ) : items.length === 0 ? (
        <EmptyState title="No open disputes" body="Errands that end as incomplete appear here." />
      ) : (
        <>
          <List className="stagger">
            {items.map((d) => {
              const reported = Number(d.reports.requester) + Number(d.reports.courier);
              return (
                <ListRow
                  key={d.id}
                  leading={
                    <IconTile color="var(--danger)">
                      <FlagIcon size={17} strokeWidth={2} />
                    </IconTile>
                  }
                  title={`${d.pickupName ?? d.pickupLocation ?? "Errand"} · ${formatCredits(d.rewardCredits)}`}
                  subtitle={
                    <>
                      Requester {shortId(d.requesterId)} · Courier {shortId(d.courierId)}
                      <br />
                      Updated {formatTime(d.updatedAt)}
                    </>
                  }
                  trailing={
                    <span className="flex flex-col items-end gap-1">
                      {d.internalStatus === "Settling-Credit" && <Pill tone="blue">Settling</Pill>}
                      <Pill tone={reported === 2 ? "success" : reported === 1 ? "orange" : "neutral"}>{reported}/2 reports</Pill>
                    </span>
                  }
                  onClick={() => setSelected(d.id)}
                />
              );
            })}
          </List>
          <LoadMore
            noun="disputes"
            shown={items.length}
            total={null}
            hasMore={hasMore}
            loading={items.length < count && hasMore}
            onLoadMore={() => setCount((c) => c + PAGE_SIZE)}
          />
        </>
      )}

      {selected && (
        <DisputeDetail key={selected} errandId={selected} onChanged={() => void load()} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
