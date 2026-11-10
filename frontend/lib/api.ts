"use client";

export interface ApiResult<T = unknown> {
  ok: boolean;
  status: number;
  data: T | null;
  code: string | null;
  message: string | null;
  etag: string | null;
  /** From a Retry-After header, when the service sent one. */
  retryAfterSeconds?: number;
}

// Nest errors are { code, message } from order-service, or { message: string | string[] } from pipes and guards.
function readError(body: unknown): { code: string | null; message: string | null } {
  if (!body || typeof body !== "object") return { code: null, message: null };
  const b = body as { code?: unknown; message?: unknown; error?: unknown; violations?: unknown; reasons?: unknown };
  // Field errors arrive as { field, reason } in `violations` (supplier-service) or `reasons` (credit-service).
  const fieldErrors = Array.isArray(b.violations) ? b.violations : Array.isArray(b.reasons) ? b.reasons : null;
  const violations = fieldErrors
    ? (fieldErrors as { field?: string; reason?: string }[]).map((v) => `${v.field}: ${v.reason}`).join("; ")
    : null;
  const message =
    violations ||
    (Array.isArray(b.message)
      ? b.message.join("; ")
      : typeof b.message === "string"
        ? b.message
        : null);
  const code =
    typeof b.code === "string" ? b.code : typeof b.error === "string" ? b.error : null;
  return { code, message };
}

let refreshing: Promise<boolean> | null = null;
let onSessionExpired: () => void = () => {};

// The page passes its router, since this module cannot navigate on its own.
export function setSessionExpiredHandler(handler: () => void): () => void {
  onSessionExpired = handler;
  return () => {
    if (onSessionExpired === handler) onSessionExpired = () => {};
  };
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
  // Dev-only and opt-in (NEXT_PUBLIC_FOC_FIXTURES=1): /home?data=worst etc. answers from fixtures instead of the services.
  if (process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_FOC_FIXTURES === "1") {
    const { isDataset } = await import("./dev-datasets");
    const dataset = new URLSearchParams(window.location.search).get("data");
    if (isDataset(dataset)) return (await import("./dev-fixtures")).fixtureResponse(dataset, input, init);
  }
  const send = () => fetch(input, { credentials: "same-origin", ...init });
  const res = await send();
  if (res.status !== 401) return res;
  if (await refreshSession()) return send();
  onSessionExpired();
  return res;
}

export async function api<T = unknown>(
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  options: { body?: unknown; idempotencyKey?: string; ifMatch?: string } = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;
  if (options.ifMatch) headers["If-Match"] = options.ifMatch;

  let status = 0;
  let body: unknown = null;
  let etag: string | null = null;
  let retryAfterSeconds: number | undefined;
  try {
    const res = await authFetch(path, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    status = res.status;
    etag = res.headers.get("ETag");
    const retryAfter = Number(res.headers.get("Retry-After"));
    if (retryAfter > 0) retryAfterSeconds = retryAfter;
    body = await res.json().catch(() => null);
  } catch {
    body = { code: "NETWORK_ERROR", message: "Could not reach the server." };
  }

  const ok = status >= 200 && status < 300;
  const { code, message } = ok ? { code: null, message: null } : readError(body);
  return { ok, status, data: ok ? (body as T) : null, code, message, etag, retryAfterSeconds };
}

// A plain sentence for a failed call: no status codes. Validation and conflict messages are written for people, so they pass through.
export function errorText(res: ApiResult, fallback: string): string {
  if (res.status === 0) return "Can't reach FoC right now. Check your connection and try again.";
  if (res.status === 401 || res.status === 403) return "You don't have permission to do that.";
  if (res.status === 429) return "Too many attempts. Wait a moment and try again.";
  if (res.status >= 500) return "Something went wrong on our side. Try again in a moment.";
  if ((res.status === 400 || res.status === 409 || res.status === 422) && res.message) return res.message;
  return fallback;
}
