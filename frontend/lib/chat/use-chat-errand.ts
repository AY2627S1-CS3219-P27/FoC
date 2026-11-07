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

export function useChatErrand(errandId: string | null): ChatErrandSummary | null {
  const [resolved, setResolved] = useState<ResolvedErrandSummary | null>(null);

  useEffect(() => {
    if (errandId === null) return;
    let active = true;

    void (async () => {
      const res = await api<Errand>("GET", `/api/errands/${errandId}`, { quiet: true });
      if (!active || !res.ok || !res.data) return;
      const errand = res.data;

      let pickupName = errand.pickupName;
      if (pickupName === null) {
        const supplier = await api<{ name: string }>(
          "GET",
          `/api/suppliers/${errand.supplierId}`,
          { quiet: true },
        );
        if (!active) return;
        if (supplier.ok && supplier.data) pickupName = supplier.data.name;
      }
      if (!active) return;

      setResolved({
        errandId,
        summary: {
          pickupName,
          deliveryLocation: errand.deliveryLocation,
          collectionItems: errand.collectionItems,
        },
      });
    })();

    return () => {
      active = false;
    };
  }, [errandId]);

  return resolved !== null && resolved.errandId === errandId ? resolved.summary : null;
}

export function formatErrandTitle(summary: ChatErrandSummary | null, fallback: string): string {
  if (summary === null) return fallback;
  const name = summary.pickupName ?? fallback;
  if (summary.deliveryLocation) return `${name} → ${summary.deliveryLocation}`;
  return name;
}
