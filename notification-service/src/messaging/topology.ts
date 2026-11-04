import type { Channel } from 'amqplib';
import { NOTIFICATION_NOTIFY_V1_ROUTING_KEY } from '@foc/contracts';

/** Producer-owned exchange every service publishes domain events to. */
export const DOMAIN_EXCHANGE = 'foc.events';
/** Service-owned retry exchange (headers): routes a retry copy to its delay lot. */
export const RETRY_EXCHANGE = 'foc.retry';
/** Service-owned return exchange: parking-lot expiry routes back to the queue. */
export const RETRY_RETURN_EXCHANGE = 'foc.back';
/** Service-owned dead-letter exchange. */
export const DEAD_LETTER_EXCHANGE = 'foc.dlq';

export const NOTIFY_QUEUE = 'notification-service.notify.v1';
export const NOTIFY_DLQ_QUEUE = `${NOTIFY_QUEUE}.dlq`;

/** Canonical fan-out event: { notificationGuid, userId, content }. */
export const NOTIFY_ROUTING_KEY = NOTIFICATION_NOTIFY_V1_ROUTING_KEY;
/**
 * Self-published per-pair delivery/retry copy:
 * { notificationGuid, subscriptionId }. Kept on its own routing key so the
 * consumer can dispatch on the route instead of guessing from the body shape.
 */
export const NOTIFY_RETRY_ROUTING_KEY = 'notification.notify-retry.v1';

/**
 * Header selecting the backoff hop for a retried message. Must NOT start with
 * `x-`: a headers exchange ignores binding keys beginning with `x-` (except
 * `x-match`), which would fan the retry into every parking-lot queue.
 */
export const DELAY_HEADER = 'foc-delay';
/** Domain delivery-attempt counter carried across republish hops. */
export const ATTEMPT_HEADER = 'x-foc-attempt';

export interface RetryStep {
  queue: string;
  delayMs: number;
}

/**
 * One parking-lot queue per backoff hop; its `x-message-ttl` is the delay and
 * every message in it waits exactly that long. The final attempt dead-letters.
 */
export const RETRY_STEPS: readonly RetryStep[] = [
  { queue: 'notify_retry_60s', delayMs: 60_000 },
  { queue: 'notify_retry_120s', delayMs: 120_000 },
  { queue: 'notify_retry_240s', delayMs: 240_000 },
  { queue: 'notify_retry_480s', delayMs: 480_000 },
];

/** One delivery per retry step, plus the final attempt that dead-letters. */
export const MAX_NOTIFY_ATTEMPTS = RETRY_STEPS.length + 1;

/** Prefetch count for the single intake consumer. */
export const CONSUMER_PREFETCH = 10;

/**
 * Coerce an attempt header into 1..MAX_NOTIFY_ATTEMPTS. Returns undefined for
 * values that cannot be a delivery attempt, so the caller can drop poison.
 */
export function attemptOf(value: unknown): number | undefined {
  if (value === undefined) {
    return 1;
  }

  const attempt = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(attempt) &&
    attempt >= 1 &&
    attempt <= MAX_NOTIFY_ATTEMPTS
    ? attempt
    : undefined;
}

/** Delay for the hop arriving at `nextAttempt` (2..MAX_NOTIFY_ATTEMPTS). */
export function retryDelayFor(nextAttempt: number): number {
  const step = RETRY_STEPS[nextAttempt - 2];
  if (!step) {
    throw new Error(`No retry hop for attempt ${nextAttempt}`);
  }
  return step.delayMs;
}

/**
 * Ensures the service's broker topology is in its expected shape before it
 * starts consuming, so a misconfigured broker fails fast. Mirrors
 * email-service's retry parking-lot topology (ADR 002).
 */
export async function assertTopology(channel: Channel): Promise<void> {
  // Shared infrastructure is producer/root-owned: check it, never mutate it.
  await channel.checkExchange(DOMAIN_EXCHANGE);
  await channel.assertExchange(RETRY_EXCHANGE, 'headers', { durable: true });
  await channel.assertExchange(RETRY_RETURN_EXCHANGE, 'direct', {
    durable: true,
  });
  await channel.assertExchange(DEAD_LETTER_EXCHANGE, 'direct', {
    durable: true,
  });

  await channel.assertQueue(NOTIFY_QUEUE, {
    durable: true,
    arguments: { 'x-queue-type': 'classic' },
  });
  await channel.bindQueue(NOTIFY_QUEUE, DOMAIN_EXCHANGE, NOTIFY_ROUTING_KEY);
  // Retried copies return with the routing key preserved by the parking lot,
  // so both the canonical and the per-pair key route back to the intake queue.
  await channel.bindQueue(
    NOTIFY_QUEUE,
    RETRY_RETURN_EXCHANGE,
    NOTIFY_ROUTING_KEY,
  );
  await channel.bindQueue(
    NOTIFY_QUEUE,
    RETRY_RETURN_EXCHANGE,
    NOTIFY_RETRY_ROUTING_KEY,
  );

  for (const step of RETRY_STEPS) {
    await channel.assertQueue(step.queue, {
      durable: true,
      arguments: {
        'x-queue-type': 'classic',
        'x-dead-letter-exchange': RETRY_RETURN_EXCHANGE,
        'x-message-ttl': step.delayMs,
      },
    });
    // Header binding maps each hop's delay to its parking-lot queue.
    await channel.bindQueue(step.queue, RETRY_EXCHANGE, '', {
      'x-match': 'all',
      [DELAY_HEADER]: String(step.delayMs),
    });
  }

  await channel.assertQueue(NOTIFY_DLQ_QUEUE, {
    durable: true,
    arguments: { 'x-queue-type': 'classic' },
  });
  await channel.bindQueue(
    NOTIFY_DLQ_QUEUE,
    DEAD_LETTER_EXCHANGE,
    NOTIFY_ROUTING_KEY,
  );
  await channel.bindQueue(
    NOTIFY_DLQ_QUEUE,
    DEAD_LETTER_EXCHANGE,
    NOTIFY_RETRY_ROUTING_KEY,
  );
}
