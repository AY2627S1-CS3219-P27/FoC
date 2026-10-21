"use client";

import { useSyncExternalStore } from "react";

export interface ApiResult<T = unknown> {
  ok: boolean;
  status: number;
  data: T | null;
  code: string | null;
  message: string | null;
  replayed: boolean;
}

export interface ApiLogEntry {
  id: number;
  at: Date;
  method: string;
  path: string;
  status: number;
  code: string | null;
  message: string | null;
  replayed: boolean;
  idempotencyKey: string | null;
}

const MAX_LOG = 50;
let log: ApiLogEntry[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function record(entry: Omit<ApiLogEntry, "id" | "at">) {
  log = [{ ...entry, id: nextId++, at: new Date() }, ...log].slice(0, MAX_LOG);
  listeners.forEach((l) => l());
}

export function clearApiLog() {
  log = [];
  listeners.forEach((l) => l());
}

export function useApiLog(): ApiLogEntry[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => log,
    () => log,
  );
}

// Nest errors are { code, message } from order-service, or { message: string | string[] } from pipes and guards.
function readError(body: unknown): { code: string | null; message: string | null } {
  if (!body || typeof body !== "object") return { code: null, message: null };
  const b = body as { code?: unknown; message?: unknown; error?: unknown };
  const message = Array.isArray(b.message)
    ? b.message.join("; ")
    : typeof b.message === "string"
      ? b.message
      : null;
  const code =
    typeof b.code === "string" ? b.code : typeof b.error === "string" ? b.error : null;
  return { code, message };
}

let refreshing: Promise<boolean> | null = null;
let onSessionExpired: () => void = () => {};

// The page passes its router, since this module cannot navigate on its own.
export function setSessionExpiredHandler(handler: () => void) {
  onSessionExpired = handler;
}

// One refresh at a time; callers that 401 together share it. Not under /api because the cookie's path is /auth/refresh.
export function refreshSession(): Promise<boolean> {
  refreshing ??= fetch("/auth/refresh", { method: "POST", credentials: "same-origin" })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

// fetch that renews an expired access token once and retries; a failed renewal ends the session.
export async function authFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const send = () => fetch(input, { credentials: "same-origin", ...init });
  const res = await send();
  if (res.status !== 401) return res;
  if (await refreshSession()) return send();
  onSessionExpired();
  return res;
}

export async function api<T = unknown>(
  method: "GET" | "POST",
  path: string,
  options: { body?: unknown; idempotencyKey?: string; quiet?: boolean } = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;

  let status = 0;
  let body: unknown = null;
  let replayed = false;
  try {
    const res = await authFetch(path, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    status = res.status;
    replayed = res.headers.get("Idempotent-Replayed") === "true";
    body = await res.json().catch(() => null);
  } catch {
    body = { code: "NETWORK_ERROR", message: "Could not reach the server." };
  }

  const ok = status >= 200 && status < 300;
  const { code, message } = ok ? { code: null, message: null } : readError(body);
  if (!options.quiet) {
    record({
      method,
      path,
      status,
      code,
      message,
      replayed,
      idempotencyKey: options.idempotencyKey ?? null,
    });
  }
  return { ok, status, data: ok ? (body as T) : null, code, message, replayed };
}
