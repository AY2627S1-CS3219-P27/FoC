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
    isOpen: true,
    close: vi.fn(async () => undefined),
  };
  return { client, sub, subs };
}

describe('RedisTrackingStore pub/sub', () => {
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

  it('uses SET NX PX for the rate slot', async () => {
    const { client } = fakeClient();
    const store = new RedisTrackingStore(client as never);
    expect(await store.acquireRateSlot('e3', 1000)).toBe(true);
    expect(client.set).toHaveBeenCalledWith('order:loc-rate:e3', '1', { NX: true, PX: 1000 });
    client.set.mockResolvedValueOnce(null as never);
    expect(await store.acquireRateSlot('e3', 1000)).toBe(false);
  });
});
