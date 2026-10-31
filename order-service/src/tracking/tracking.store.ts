import type { CachedRoute, Position, TrackingEvent } from './tracking.types.js';

export const TRACKING_STORE = Symbol('TRACKING_STORE');

export type Unsubscribe = () => Promise<void>;

// The only thing the tracking code knows about Redis. A fake implements it in
// tests (fake-tracking.store.ts), so unit tests need no Redis.
export interface TrackingStore {
  // True if this update may proceed; false if one was accepted less than
  // `minIntervalMs` ago (atomic: SET NX PX).
  acquireRateSlot(errandId: string, minIntervalMs: number): Promise<boolean>;
  setPosition(errandId: string, position: Position, ttlS: number): Promise<void>;
  getPosition(errandId: string): Promise<Position | null>;
  setRoute(errandId: string, route: CachedRoute, ttlS: number): Promise<void>;
  getRoute(errandId: string): Promise<CachedRoute | null>;
  // Deletes the position, route and rate keys of an errand.
  clear(errandId: string): Promise<void>;
  publish(errandId: string, event: TrackingEvent): Promise<void>;
  // Resolves once the subscription is active. The returned function releases it.
  subscribe(errandId: string, onEvent: (event: TrackingEvent) => void): Promise<Unsubscribe>;
}
