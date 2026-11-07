"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

interface PublicUserInfo {
  displayName: string;
}

const cache = new Map<string, string>();
const inFlight = new Map<string, Promise<string | null>>();

export async function getDisplayName(uuid: string): Promise<string | null> {
  const cached = cache.get(uuid);
  if (cached !== undefined) return cached;

  const pending = inFlight.get(uuid);
  if (pending) return pending;

  const request = (async () => {
    const res = await api<PublicUserInfo>("GET", `/api/users/${uuid}`, { quiet: true });
    if (!res.ok || !res.data || typeof res.data.displayName !== "string" || res.data.displayName.length === 0) {
      return null;
    }
    cache.set(uuid, res.data.displayName);
    return res.data.displayName;
  })().finally(() => {
    inFlight.delete(uuid);
  });

  inFlight.set(uuid, request);
  return request;
}

export function useDisplayName(uuid: string | null): string | null {
  const [resolved, setResolved] = useState<{ uuid: string; name: string | null } | null>(null);

  useEffect(() => {
    if (uuid === null || cache.has(uuid)) return;
    let active = true;
    void getDisplayName(uuid).then((name) => {
      if (active) setResolved({ uuid, name });
    });
    return () => {
      active = false;
    };
  }, [uuid]);

  if (uuid === null) return null;
  const cached = cache.get(uuid);
  if (cached !== undefined) return cached;
  return resolved !== null && resolved.uuid === uuid ? resolved.name : null;
}
