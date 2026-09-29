import { logger } from '../../utils/logger.ts';
import { redis } from './redis-client.ts';

const DEDUP_PREFIX = 'email:seen';
const DEDUP_TTL_SECONDS = 15 * 60;

function dedupKey(messageId: string): string {
  return `${DEDUP_PREFIX}:${messageId}`;
}
/**
 * Atomic check-and-mark in one round trip: SET NX returns 'OK' when the id
 * was newly recorded (not a duplicate) and null when it was already present.
 * Fail-open: an unavailable store is treated as "not seen" so the send is
 * still attempted.
 */
export async function isDuplicate(messageId: string): Promise<boolean> {
  try {
    const result = await redis.set(dedupKey(messageId), '1', {
      EX: DEDUP_TTL_SECONDS,
      NX: true,
    });
    return result === null;
  } catch (err) {
    logger.warn({ err }, 'Dedup store unavailable; sending without dedup');
    return false;
  }
}

/**
 * Forget a messageId after a failed send so the retried copy is not
 * suppressed. Fail-open: a failed delete just means that retry also runs
 * without dedup.
 */
export async function forgetMessageId(messageId: string): Promise<void> {
  try {
    await redis.del(dedupKey(messageId));
  } catch (err) {
    logger.warn({ err }, 'Failed to clear dedup mark');
  }
}
