import { createHash } from 'node:crypto';

/**
 * JSON with object keys sorted at every level, so two bodies that differ only
 * in key order have the same text. Arrays keep their order.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value)) ?? 'null';
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, sortKeys(item)]),
    );
  }
  return value;
}

export interface RequestParts {
  method: string;
  /** The path without its query string. */
  path: string;
  body: unknown;
  /** Part of the request: an edit based on another version is another request. */
  ifMatch?: string | undefined;
}

/**
 * Identifies "the same request" for an idempotency key (F14.2.1, F14.2.2):
 * the method, the path, the body (key order ignored) and any If-Match, as a
 * SHA-256 hex digest. The same key on another endpoint is therefore a
 * different request.
 */
export function requestFingerprint(parts: RequestParts): string {
  const text = canonicalJson({
    method: parts.method.toUpperCase(),
    path: parts.path,
    body: parts.body ?? null,
    ifMatch: parts.ifMatch ?? null,
  });
  return createHash('sha256').update(text).digest('hex');
}
