// How long to wait before the next retry

export interface BackoffOptions {
  baseMs: number;
  maxMs: number;
  random?: () => number;
}

/**
 * @param attempt which retry this is: 1 = the first retry, 2 = the second, ...
 * @returns milliseconds to wait, a whole number from 0 up to the capped value
 */
export function backoffDelay(attempt: number, options: BackoffOptions): number {
  const { baseMs, maxMs, random = Math.random } = options;
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error(`attempt must be a whole number from 1, got ${attempt}`);
  }
  if (!(baseMs > 0)) {
    throw new Error(`baseMs must be positive, got ${baseMs}`);
  }
  if (!(maxMs >= baseMs)) {
    throw new Error(`maxMs must be at least baseMs (${baseMs}), got ${maxMs}`);
  }

  const exponential = baseMs * 2 ** (attempt - 1);
  const capped = Math.min(exponential, maxMs);

  return Math.round(random() * capped);
}
