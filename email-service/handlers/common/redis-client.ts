import { createClient } from 'redis';
import { envs } from '../../utils/envs.ts';
import { logger } from '../../utils/logger.ts';

// Redis store for dedup/idempotency
export const redis = createClient({
  socket: {
    host: envs.REDIS_HOST,
    port: envs.REDIS_PORT,
  },
  username: envs.REDIS_USERNAME,
  database: envs.REDIS_DB_INDEX,
  // Matches the old ioredis `enableOfflineQueue: false`: commands issued while
  // not connected reject instead of queueing forever, so a down store keeps
  // the dedup path fail-open instead of hanging.
  disableOfflineQueue: true,
});
redis.on('error', (err) => {
  logger.error({ err }, 'Redis connection error');
});
// Fire-and-forget: ioredis connected lazily and never blocked broker startup,
// so neither should we. Failures surface via the error listener above (and
// the catch below just prevents an unhandled rejection).
void redis.connect().catch(() => {});
