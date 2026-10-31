import { Logger } from '@nestjs/common';
import type { RedisClientType } from 'redis';
import type { TrackingStore, Unsubscribe } from './tracking.store.js';
import {
  eventsChannel,
  locationKey,
  rateKey,
  routeKey,
  type CachedRoute,
  type Position,
  type TrackingEvent,
} from './tracking.types.js';

type Handler = (event: TrackingEvent) => void;

const parse = <T>(raw: string | null): T | null => {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

// Redis-backed store. Pub/sub uses ONE duplicated connection shared by all SSE
// streams, ref-counted per channel: the first listener on a channel subscribes,
// the last one to leave unsubscribes. A disconnecting client therefore never
// leaves a Redis subscription behind.
export class RedisTrackingStore implements TrackingStore {
  private readonly logger = new Logger('TrackingStore');
  private subscriber?: RedisClientType<any, any, any>;
  private readonly handlers = new Map<string, Set<Handler>>();
  private readonly dispatchers = new Map<string, (message: string) => void>();

  constructor(private readonly client: RedisClientType<any, any, any>) {}

  async acquireRateSlot(errandId: string, minIntervalMs: number) {
    const ok = await this.client.set(rateKey(errandId), '1', {
      NX: true,
      PX: Math.max(1, Math.floor(minIntervalMs)),
    });
    return ok === 'OK';
  }

  async setPosition(errandId: string, position: Position, ttlS: number) {
    await this.client.set(locationKey(errandId), JSON.stringify(position), { EX: ttlS });
  }

  async getPosition(errandId: string) {
    return parse<Position>(await this.client.get(locationKey(errandId)));
  }

  async setRoute(errandId: string, route: CachedRoute, ttlS: number) {
    await this.client.set(routeKey(errandId), JSON.stringify(route), { EX: ttlS });
  }

  async getRoute(errandId: string) {
    return parse<CachedRoute>(await this.client.get(routeKey(errandId)));
  }

  async clear(errandId: string) {
    await this.client.del([locationKey(errandId), routeKey(errandId), rateKey(errandId)]);
  }

  async publish(errandId: string, event: TrackingEvent) {
    await this.client.publish(eventsChannel(errandId), JSON.stringify(event));
  }

  async subscribe(errandId: string, onEvent: Handler): Promise<Unsubscribe> {
    const channel = eventsChannel(errandId);
    let set = this.handlers.get(channel);
    const first = !set;
    if (!set) {
      set = new Set();
      this.handlers.set(channel, set);
    }
    set.add(onEvent);

    if (first) {
      const dispatcher = (message: string) => {
        const event = parse<TrackingEvent>(message);
        if (!event) return;
        for (const h of this.handlers.get(channel) ?? []) {
          try {
            h(event);
          } catch {
            // A broken listener must not stop the others.
          }
        }
      };
      this.dispatchers.set(channel, dispatcher);
      try {
        const sub = await this.ensureSubscriber();
        await sub.subscribe(channel, dispatcher);
      } catch (e) {
        this.handlers.delete(channel);
        this.dispatchers.delete(channel);
        throw e;
      }
    }

    let released = false;
    return async () => {
      if (released) return;
      released = true;
      const current = this.handlers.get(channel);
      if (!current) return;
      current.delete(onEvent);
      if (current.size > 0) return;
      this.handlers.delete(channel);
      const dispatcher = this.dispatchers.get(channel);
      this.dispatchers.delete(channel);
      if (dispatcher && this.subscriber) {
        try {
          await this.subscriber.unsubscribe(channel, dispatcher);
        } catch (e) {
          this.logger.warn(`unsubscribe failed: ${String(e)}`);
        }
      }
    };
  }

  private async ensureSubscriber() {
    if (!this.subscriber) {
      const sub = this.client.duplicate();
      sub.on('error', (err: Error) =>
        this.logger.error(`Redis subscriber error: ${err.message}`),
      );
      this.subscriber = sub;
      await sub.connect();
    }
    return this.subscriber;
  }

  // Number of live channel subscriptions (for tests / diagnostics).
  get activeChannels() {
    return this.handlers.size;
  }

  async close() {
    if (this.subscriber?.isOpen) await this.subscriber.close();
    if (this.client.isOpen) await this.client.close();
  }
}
