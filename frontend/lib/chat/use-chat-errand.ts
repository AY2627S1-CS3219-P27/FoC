"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Errand } from "@/app/home/_errands/types";

export interface ChatErrandSummary {
  pickupName: string | null;
  deliveryLocation: string | null;
  collectionItems: string;
}

interface ResolvedErrandSummary {
  errandId: string;
  summary: ChatErrandSummary;
}

const summaryCache = new Map<string, ChatErrandSummary>();
const summaryInFlight = new Map<string, Promise<ChatErrandSummary | null>>();

async function fetchErrandSummary(errandId: string): Promise<ChatErrandSummary | null> {
  const cached = summaryCache.get(errandId);
  if (cached !== undefined) return cached;

  const pending = summaryInFlight.get(errandId);
  if (pending) return pending;

  const request = (async () => {
    const res = await api<Errand>("GET", `/api/errands/${errandId}`);
    if (!res.ok || !res.data) return null;
    const errand = res.data;

    let pickupName = errand.pickupName;
    if (pickupName === null) {
      const supplier = await api<{ name: string }>("GET", `/api/suppliers/${errand.supplierId}`);
      if (supplier.ok && supplier.data) pickupName = supplier.data.name;
    }

    const summary: ChatErrandSummary = {
      pickupName,
      deliveryLocation: errand.deliveryLocation,
      collectionItems: errand.collectionItems,
    };
    summaryCache.set(errandId, summary);
    return summary;
  })().finally(() => {
    summaryInFlight.delete(errandId);
  });

  summaryInFlight.set(errandId, request);
  return request;
}

export function useChatErrand(errandId: string | null): ChatErrandSummary | null {
  const [resolved, setResolved] = useState<ResolvedErrandSummary | null>(null);

  useEffect(() => {
    if (errandId === null || summaryCache.has(errandId)) return;
    let active = true;
    void fetchErrandSummary(errandId).then((summary) => {
      if (active && summary) setResolved({ errandId, summary });
    });
    return () => {
      active = false;
    };
  }, [errandId]);

  if (errandId === null) return null;
  const cached = summaryCache.get(errandId);
  if (cached !== undefined) return cached;
  return resolved !== null && resolved.errandId === errandId ? resolved.summary : null;
}

export function formatErrandTitle(summary: ChatErrandSummary | null, fallback: string): string {
  if (summary === null) return fallback;
  const name = summary.pickupName ?? fallback;
  if (summary.deliveryLocation) return `${name} → ${summary.deliveryLocation}`;
  return name;
}
