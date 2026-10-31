import { RedisTrackingStore } from './redis-tracking.store.js';
import { eventsChannel } from './tracking.types.js';

// Minimal stand-in for node-redis: records subscribe/unsubscribe calls.
function fakeClient() {
  const subs = new Map<string, (m: string) => void>();
  const sub = {
    on: vi.fn(),
    connect: vi.fn(async () => undefined),
    isOpen: true,
    close: vi.fn(async () => undefined),
    subscribe: vi.fn(async (ch: string, fn: (m: string) => void) => void subs.set(ch, fn)),
    unsubscribe: vi.fn(async (ch: string) => void subs.delete(ch)),
  };
  const client = {
    duplicate: vi.fn(() => sub),
    set: vi.fn(async () => 'OK'),
    del: vi.fn(async () => 1),
    isReady: false,
    destroy: vi.fn(),
    isOpen: true,
    close: vi.fn(async () => undefined),
  };
  return { client, sub, subs };
}

describe('RedisTrackingStore pub/sub', () => {
  it('makes a concurrent second subscriber wait for the in-flight SUBSCRIBE', async () => {
    const { client, sub } = fakeClient();
    let release!: () => void;
    sub.subscribe.mockImplementation(
      () => new Promise<undefined>((r) => { release = () => r(undefined); }),
    );
    const store = new RedisTrackingStore(client as never);
    let secondDone = false;
    const first = store.subscribe('e4', vi.fn());
    const second = store.subscribe('e4', vi.fn()).then((off) => { secondDone = true; return off; });
    await new Promise((r) => setTimeout(r, 10));
    expect(secondDone).toBe(false); // not returned before Redis is subscribed
    expect(sub.subscribe).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second]);
    expect(secondDone).toBe(true);
  });

  it('rejects every waiting caller if the first SUBSCRIBE fails, and cleans up', async () => {
    const { client, sub } = fakeClient();
    sub.subscribe.mockRejectedValueOnce(new Error('boom'));
    const store = new RedisTrackingStore(client as never);
    const results = await Promise.allSettled([
      store.subscribe('e5', vi.fn()),
      store.subscribe('e5', vi.fn()),
    ]);
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    expect(store.activeChannels).toBe(0);
    // A later caller starts afresh and succeeds.
    const off = await store.subscribe('e5', vi.fn());
    expect(store.activeChannels).toBe(1);
    await off();
    expect(store.activeChannels).toBe(0);
  });

  it('ref-counts one Redis subscription per channel and releases the last one', async () => {
    const { client, sub, subs } = fakeClient();
    const store = new RedisTrackingStore(client as never);
    const a = vi.fn();
    const b = vi.fn();
    const offA = await store.subscribe('e1', a);
    const offB = await store.subscribe('e1', b);
    expect(client.duplicate).toHaveBeenCalledTimes(1);
    expect(sub.subscribe).toHaveBeenCalledTimes(1);

    const ev = { type: 'ended', reason: 'DELIVERED', status: 'Delivered' };
    subs.get(eventsChannel('e1'))!(JSON.stringify(ev));
    expect(a).toHaveBeenCalledWith(ev);
    expect(b).toHaveBeenCalledWith(ev);

    await offA();
    await offA(); // idempotent
    expect(sub.unsubscribe).not.toHaveBeenCalled();
    await offB();
    expect(sub.unsubscribe).toHaveBeenCalledTimes(1);
    expect(subs.size).toBe(0);
    expect(store.activeChannels).toBe(0);
  });

  it('ignores malformed messages and isolates throwing listeners', async () => {
    const { client, subs } = fakeClient();
    const store = new RedisTrackingStore(client as never);
    const good = vi.fn();
    await store.subscribe('e2', () => {
      throw new Error('x');
    });
    await store.subscribe('e2', good);
    const dispatch = subs.get(eventsChannel('e2'))!;
    dispatch('not json');
    dispatch(JSON.stringify({ type: 'location', lat: 1 }));
    expect(good).toHaveBeenCalledTimes(1);
  });

  it('reports readiness from the client and releases a rate slot with DEL', async () => {
    const { client } = fakeClient();
    const store = new RedisTrackingStore(client as never);
    expect(store.isReady()).toBe(false);
    client.isReady = true;
    expect(store.isReady()).toBe(true);
    await store.releaseRateSlot('e6');
    expect(client.del).toHaveBeenCalledWith('order:loc-rate:e6');
  });

  it('uses SET NX PX for the rate slot', async () => {
    const { client } = fakeClient();
    const store = new RedisTrackingStore(client as never);
    expect(await store.acquireRateSlot('e3', 1000)).toBe(true);
    expect(client.set).toHaveBeenCalledWith('order:loc-rate:e3', '1', { NX: true, PX: 1000 });
    client.set.mockResolvedValueOnce(null as never);
    expect(await store.acquireRateSlot('e3', 1000)).toBe(false);
  });
});

describe('createTrackingStore (Redis unreachable)', () => {
  it('returns immediately, never throws, and reports not ready', async () => {
    const { createTrackingStore } = await import('./redis-tracking.provider.js');
    const started = Date.now();
    const store = createTrackingStore({ host: '127.0.0.1', port: 1, username: 'u', database: 1 });
    try {
      expect(Date.now() - started).toBeLessThan(500);
      expect(store.isReady()).toBe(false);
      await new Promise((r) => setTimeout(r, 150)); // let a connect attempt fail
      expect(store.isReady()).toBe(false);
    } finally {
      await store.close();
    }
  });
});
