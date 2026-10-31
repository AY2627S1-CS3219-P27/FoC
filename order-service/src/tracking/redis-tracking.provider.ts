import { Logger } from '@nestjs/common';
import { createClient } from 'redis';
import { RedisTrackingStore } from './redis-tracking.store.js';

export interface RedisConnectionOptions {
  host: string;
  port: number;
  username: string;
  database: number;
}

const logger = new Logger('TrackingRedis');

// Builds the store and starts connecting in the background. NEVER throws and
// never waits for Redis: tracking is a side feature and must not take the
// lifecycle service down. While Redis is not ready the store reports
// isReady() === false and the tracking routes answer 503 TRACKING_UNAVAILABLE.
// node-redis reconnects forever with the backoff below.
export function createTrackingStore(o: RedisConnectionOptions): RedisTrackingStore {
  const client = createClient({
    socket: {
      host: o.host,
      port: o.port,
      reconnectStrategy: (retries: number) =>
        Math.min(2 ** retries * 50, 5000) + Math.floor(Math.random() * 200),
    },
    username: o.username,
    database: o.database,
  });
  // State changes only; messages carry no credentials or coordinates.
  client.on('error', (err: Error) => logger.error(`Redis error: ${err.message}`));
  client.on('ready', () => logger.log('Redis ready'));
  client.on('reconnecting', () => logger.warn('Redis reconnecting'));
  client.on('end', () => logger.warn('Redis connection closed'));
  client.connect().catch((err: Error) => logger.error(`Redis connect failed: ${err.message}`));
  return new RedisTrackingStore(client);
}
