import type { TrackingStore, Unsubscribe } from './tracking.store.js';
import {
  eventsChannel,
  type CachedRoute,
  type Position,
  type TrackingEvent,
} from './tracking.types.js';

// In-memory TrackingStore for unit tests. TTLs are recorded, not enforced, so
// tests can assert them; `now` is injectable for the rate limiter.
export class FakeTrackingStore implements TrackingStore {
  positions = new Map<string, { value: Position; ttlS: number }>();
  routes = new Map<string, { value: CachedRoute; ttlS: number }>();
  published: { errandId: string; event: TrackingEvent }[] = [];
  private rate = new Map<string, number>();
  private listeners = new Map<string, Set<(e: TrackingEvent) => void>>();
  failWith?: Error;
  ready = true;
  failSetPosition?: Error;
  rateReleases = 0;

  constructor(public now: () => number = Date.now) {}

  private check() {
    if (this.failWith) throw this.failWith;
  }

  async acquireRateSlot(errandId: string, minIntervalMs: number) {
    this.check();
    const last = this.rate.get(errandId);
    if (last !== undefined && this.now() - last < minIntervalMs) return false;
    this.rate.set(errandId, this.now());
    return true;
  }
  async releaseRateSlot(errandId: string) {
    this.rateReleases++;
    this.rate.delete(errandId);
  }
  isReady() {
    return this.ready;
  }
  async setPosition(errandId: string, value: Position, ttlS: number) {
    this.check();
    if (this.failSetPosition) throw this.failSetPosition;
    this.positions.set(errandId, { value, ttlS });
  }
  async getPosition(errandId: string) {
    this.check();
    return this.positions.get(errandId)?.value ?? null;
  }
  async setRoute(errandId: string, value: CachedRoute, ttlS: number) {
    this.check();
    this.routes.set(errandId, { value, ttlS });
  }
  async getRoute(errandId: string) {
    this.check();
    return this.routes.get(errandId)?.value ?? null;
  }
  async clear(errandId: string) {
    this.check();
    this.positions.delete(errandId);
    this.routes.delete(errandId);
    this.rate.delete(errandId);
  }
  async publish(errandId: string, event: TrackingEvent) {
    this.check();
    this.published.push({ errandId, event });
    for (const l of this.listeners.get(eventsChannel(errandId)) ?? []) l(event);
  }
  async subscribe(errandId: string, onEvent: (e: TrackingEvent) => void): Promise<Unsubscribe> {
    const ch = eventsChannel(errandId);
    const set = this.listeners.get(ch) ?? new Set();
    set.add(onEvent);
    this.listeners.set(ch, set);
    return async () => {
      set.delete(onEvent);
    };
  }
  get listenerCount() {
    let n = 0;
    for (const s of this.listeners.values()) n += s.size;
    return n;
  }
}
