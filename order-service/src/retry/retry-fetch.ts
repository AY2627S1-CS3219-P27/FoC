import { backoffDelay, type BackoffOptions } from './backoff.js';

// Retries one HTTP call: retry only failures that may go away, wait longer
// each time, and give up after a limit.

export interface RetryOptions {
  maxAttempts: number;
  timeoutMs: number;
  backoff: BackoffOptions; 
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export type Failure =
  | { kind: 'network'; error: unknown } 
  | { kind: 'timeout' } 
  | { kind: 'status'; status: number; retryAfter?: string }; 

export class RetryError extends Error {
  constructor(
    readonly attempts: number,
    readonly lastFailure: Failure,
  ) {
    super(`gave up after ${attempts} attempt(s): ${describeFailure(lastFailure)}`);
  }
}

// A short text for logs and the RetryError message.
export function describeFailure(failure: Failure): string {
  switch (failure.kind) {
    case 'network':
      return `network error: ${networkReason(failure.error)}`;
    case 'timeout':
      return 'timed out';
    case 'status':
      return `HTTP ${failure.status}`;
    default: {
      // Only reachable if a new kind is added to Failure and not handled above.
      const unhandled: never = failure;
      return `unknown failure: ${JSON.stringify(unhandled)}`;
    }
  }
}


function networkReason(error: unknown): string {
  const code = (error as { cause?: { code?: unknown } })?.cause?.code;
  if (typeof code === 'string') return code;
  return error instanceof Error ? error.message : String(error);
}

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

export function isRetryable(failure: Failure): boolean {
  switch (failure.kind) {
    case 'network':
    case 'timeout':
      return true;
    case 'status':
      return RETRYABLE_STATUSES.has(failure.status);
    default: {
      const unhandled: never = failure;
      return unhandled;
    }
  }
}

export function parseRetryAfter(
  value: string | undefined,
  now: () => number,
): number | undefined {
  const text = value?.trim();
  if (!text) return undefined;

  if (/^\d+$/.test(text)) return Number(text) * 1000;

  if (!/[a-z]/i.test(text)) return undefined;
  const at = Date.parse(text);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, at - now()); 
}

// How long to wait before retry number `retry` (1 = first retry).
export function delayBefore(
  retry: number,
  failure: Failure,
  options: RetryOptions,
): number {
  const asked =
    failure.kind === 'status'
      ? parseRetryAfter(failure.retryAfter, options.now ?? Date.now)
      : undefined;
  if (asked === undefined) return backoffDelay(retry, options.backoff);
  return Math.min(asked, options.backoff.maxMs);
}

const realSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

async function attempt(
  url: string,
  init: RequestInit,
  options: RetryOptions,
): Promise<Response | Failure> {
  const timeout = new AbortController();
  const timer = setTimeout(
    () => timeout.abort(new DOMException('attempt timed out', 'TimeoutError')),
    options.timeoutMs,
  );
  const signal = init.signal
    ? AbortSignal.any([init.signal, timeout.signal])
    : timeout.signal;
  try {
    return await (options.fetch ?? fetch)(url, { ...init, signal });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    if (timeout.signal.aborted) return { kind: 'timeout' };
    return { kind: 'network', error };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options: RetryOptions,
): Promise<Response> {
  if (!Number.isInteger(options.maxAttempts) || options.maxAttempts < 1) {
    throw new Error(`maxAttempts must be a whole number from 1, got ${options.maxAttempts}`);
  }
  const sleep = options.sleep ?? realSleep;

  for (let tries = 1; ; tries++) {
    init.signal?.throwIfAborted();
    const outcome = await attempt(url, init, options);

    let failure: Failure;
    if (outcome instanceof Response) {
      failure = {
        kind: 'status',
        status: outcome.status,
        retryAfter: outcome.headers.get('retry-after') ?? undefined,
      };
      if (outcome.ok || !isRetryable(failure)) return outcome;
      await outcome.body?.cancel().catch(() => {});
    } else {
      failure = outcome;
    }

    if (tries >= options.maxAttempts) throw new RetryError(tries, failure);
    await sleep(delayBefore(tries, failure, options));
  }
}
