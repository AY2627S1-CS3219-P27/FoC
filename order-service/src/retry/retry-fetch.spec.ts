import {
  delayBefore,
  describeFailure,
  type Failure,
  fetchWithRetry,
  isRetryable,
  parseRetryAfter,
  RetryError,
  type RetryOptions,
} from './retry-fetch.js';

// A fake fetch that answers from a script, one entry per call: a status code,
// a whole Response (to send headers), or an Error to throw (a network
// failure). Records each call's init so tests can check what was sent (e.g.
// the same Idempotency-Key every time).
function scriptedFetch(script: (number | Response | Error)[]) {
  const calls: RequestInit[] = [];
  const fn = async (_url: string | URL | Request, init: RequestInit = {}) => {
    calls.push(init);
    const next = script[calls.length - 1];
    if (next === undefined) throw new Error('fetch called more times than scripted');
    if (next instanceof Error) throw next;
    if (next instanceof Response) return next;
    return new Response(null, { status: next });
  };
  return { fetch: fn as typeof fetch, calls };
}

function testOptions(over: Partial<RetryOptions> = {}) {
  const slept: number[] = [];
  const options: RetryOptions = {
    maxAttempts: 4,
    timeoutMs: 1_000,
    backoff: { baseMs: 100, maxMs: 1_000, random: () => 0.5 },
    sleep: async (ms) => {
      slept.push(ms);
    },
    now: () => Date.parse('2026-10-18T00:00:00Z'),
    ...over,
  };
  return { options, slept };
}

const status = (code: number, retryAfter?: string): Failure => ({
  kind: 'status',
  status: code,
  retryAfter,
});

describe('describeFailure', () => {
  it('names each kind of failure', () => {
    expect(describeFailure({ kind: 'timeout' })).toBe('timed out');
    expect(describeFailure(status(503))).toBe('HTTP 503');
    expect(describeFailure({ kind: 'network', error: new Error('socket hang up') })).toBe(
      'network error: socket hang up',
    );
  });

  it("prefers the code Node's fetch keeps in error.cause", () => {
    const error = new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
    expect(describeFailure({ kind: 'network', error })).toBe('network error: ECONNREFUSED');
  });

  it('copes with a thrown value that is not an Error', () => {
    expect(describeFailure({ kind: 'network', error: 'boom' })).toBe('network error: boom');
  });

  it('is what RetryError says', () => {
    expect(new RetryError(3, status(503)).message).toBe('gave up after 3 attempt(s): HTTP 503');
  });
});

describe('isRetryable', () => {
  it('retries a network failure and a timeout', () => {
    expect(isRetryable({ kind: 'network', error: new Error('reset') })).toBe(true);
    expect(isRetryable({ kind: 'timeout' })).toBe(true);
  });

  it.each([408, 429, 500, 502, 503, 504])('retries HTTP %i', (code) => {
    expect(isRetryable(status(code))).toBe(true);
  });

  it.each([400, 401, 403, 404, 409, 422, 501])('does not retry HTTP %i', (code) => {
    expect(isRetryable(status(code))).toBe(false);
  });
});

describe('parseRetryAfter', () => {
  const now = () => Date.parse('2026-10-18T00:00:00Z');

  it('reads whole seconds', () => {
    expect(parseRetryAfter('5', now)).toBe(5_000);
    expect(parseRetryAfter(' 0 ', now)).toBe(0);
  });

  it('reads an HTTP date as the time from now', () => {
    expect(parseRetryAfter('Sun, 18 Oct 2026 00:00:30 GMT', now)).toBe(30_000);
  });

  it('treats a date in the past as 0', () => {
    expect(parseRetryAfter('Sat, 17 Oct 2026 23:59:00 GMT', now)).toBe(0);
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['blank', '   '],
    ['negative', '-5'],
    ['fractional', '1.5'],
    ['garbage', 'soon'],
  ])('returns undefined for a %s value', (_, value) => {
    expect(parseRetryAfter(value, now)).toBeUndefined();
  });
});

describe('delayBefore', () => {
  // backoff: base 100, max 1000, random 0.5 → retry n waits 0.5 * min(100 * 2^(n-1), 1000)
  const { options } = testOptions();

  it('uses backoffDelay when the server gave no Retry-After', () => {
    expect(delayBefore(1, status(503), options)).toBe(50);
    expect(delayBefore(3, { kind: 'timeout' }, options)).toBe(200);
  });

  it('uses Retry-After when the server gave one', () => {
    expect(delayBefore(1, status(429, '0'), options)).toBe(0);
  });

  it('falls back to backoffDelay for an unreadable Retry-After', () => {
    expect(delayBefore(1, status(429, 'soon'), options)).toBe(50);
  });

  it('caps a huge Retry-After at backoff.maxMs', () => {
    expect(delayBefore(1, status(503, '3600'), options)).toBe(1_000);
  });
});

describe('fetchWithRetry', () => {
  const url = 'http://order-service.test/v1/errands';

  // Runs fetchWithRetry over a scripted fetch; returns what it resolved or threw.
  async function run(
    script: (number | Response | Error)[],
    over: Partial<RetryOptions> = {},
    init: RequestInit = {},
  ) {
    const fake = scriptedFetch(script);
    const { options, slept } = testOptions({ fetch: fake.fetch, ...over });
    try {
      return { res: await fetchWithRetry(url, init, options), calls: fake.calls, slept };
    } catch (error) {
      return { error, calls: fake.calls, slept };
    }
  }

  it('returns the first ok response without waiting', async () => {
    const { res, calls, slept } = await run([200]);
    expect(res?.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(slept).toEqual([]);
  });

  it('retries 503, 503, then returns the 200 (3 calls, 2 waits)', async () => {
    const { res, calls, slept } = await run([503, 503, 200]);
    expect(res?.status).toBe(200);
    expect(calls).toHaveLength(3);
    expect(slept).toEqual([50, 100]); // backoff: 0.5 * 100, then 0.5 * 200
  });

  it('retries a network error, then succeeds', async () => {
    const refused = new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
    const { res, calls } = await run([refused, 200]);
    expect(res?.status).toBe(200);
    expect(calls).toHaveLength(2);
  });

  it('returns a 409 at once: retrying cannot change it, and the caller wants its body', async () => {
    const conflict = Response.json({ code: 'STATE_MISMATCH' }, { status: 409 });
    const { res, calls, slept } = await run([conflict]);
    expect(res?.status).toBe(409);
    expect(await res?.json()).toEqual({ code: 'STATE_MISMATCH' });
    expect(calls).toHaveLength(1);
    expect(slept).toEqual([]);
  });

  it('stops retrying as soon as an answer is not retryable', async () => {
    const { res, calls } = await run([503, 400]);
    expect(res?.status).toBe(400);
    expect(calls).toHaveLength(2);
  });

  it('gives up after maxAttempts, with the last failure in RetryError', async () => {
    const { error, calls, slept } = await run([503, 503, 502], { maxAttempts: 3 });
    expect(error).toBeInstanceOf(RetryError);
    expect(error).toMatchObject({
      attempts: 3,
      lastFailure: { kind: 'status', status: 502 },
      message: 'gave up after 3 attempt(s): HTTP 502',
    });
    expect(calls).toHaveLength(3);
    expect(slept).toHaveLength(2); // no wait after the last try
  });

  it('counts a hung request as a timeout', async () => {
    // Never answers; only rejects when its signal aborts.
    const hang = ((_url: unknown, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      })) as typeof fetch;
    const { options } = testOptions({ fetch: hang, timeoutMs: 10, maxAttempts: 2 });

    await expect(fetchWithRetry(url, {}, options)).rejects.toMatchObject({
      attempts: 2,
      lastFailure: { kind: 'timeout' },
    });
  });

  it('waits as long as Retry-After says on a 429', async () => {
    const busy = new Response(null, { status: 429, headers: { 'Retry-After': '0' } });
    const { res, slept } = await run([busy, 200]);
    expect(res?.status).toBe(200);
    expect(slept).toEqual([0]); // the server's 0, not the backoff's 50
  });

  it('sends the same Idempotency-Key on every attempt', async () => {
    const init = { method: 'POST', headers: { 'Idempotency-Key': 'confirm-1' } };
    const { calls } = await run([503, 503, 200], {}, init);
    expect(calls.map((c) => (c.headers as Record<string, string>)['Idempotency-Key'])).toEqual([
      'confirm-1',
      'confirm-1',
      'confirm-1',
    ]);
  });

  it('stops without retrying when the caller aborts', async () => {
    const caller = new AbortController();
    caller.abort(new Error('user left the page'));
    const { error, calls } = await run([200], {}, { signal: caller.signal });
    expect(error).toMatchObject({ message: 'user left the page' });
    expect(calls).toHaveLength(0);
  });

  it.each([0, -1, 1.5])('refuses maxAttempts %s', async (maxAttempts) => {
    const { error } = await run([200], { maxAttempts });
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/maxAttempts/);
  });
});
