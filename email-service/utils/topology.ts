import amqplib from 'amqplib';

/**
 * Header selecting the backoff hop for a retried message.
 *
 * NOTE: the key deliberately does NOT start with `x-`. RabbitMQ's headers
 * exchange ignores binding-argument keys beginning with `x-` (except
 * `x-match`) when `x-match` is `all`/`any`, so such a header would match every
 * binding and fan the retry out to every parking-lot queue. Keep this key
 * free of the `x-` prefix.
 *
 * foc.retry matches this against per-hop header bindings, leaving the
 * message's own routing key untouched so the return hop (retry queue DLX ->
 * foc.back) can route back to the originating queue by key.
 */
export const DELAY_HEADER = 'foc-delay';

/** Header carrying the delivery-attempt counter across republish hops. */
export const ATTEMPT_HEADER = 'x-foc-attempt';

export const RETRY_EXCHANGE = 'foc.retry';
export const DLQ_EXCHANGE = 'foc.dlq';
export const BACK_EXCHANGE = 'foc.back';
export const OTP_QUEUE = 'otp_emails';
export const DLQ_QUEUE = 'otp_emails.dlq';
export const OTP_EMAIL_ROUTING_KEY = 'otp.email';

/**
 * One generic parking-lot queue per backoff hop, shared by every message type
 * the email service handles (OTP).
 */
export interface RetryStep {
  /** Name of the retry queue; served by foc.retry's headers exchange. */
  queue: string;
  /**
   * Hop delay for this step. It is the queue's `x-message-ttl` AND the
   * `foc-delay` header value on a republished message — held together here
   * so the two can't be maintained out of sync.
   */
  delayMs: number;
}

/**
 * One retry step per delivery attempt below the last (the final attempt
 * dead-letters instead). A queue's delay (its `x-message-ttl`) is uniform for
 * all of its messages, so expiry is exact — unlike per-message TTL on a shared
 * queue, where a long-TTL head message blocks short-TTL messages behind it.
 */
export const RETRY_STEPS: readonly RetryStep[] = [
  { queue: 'email_retry_60s', delayMs: 60_000 },
  { queue: 'email_retry_120s', delayMs: 120_000 },
  { queue: 'email_retry_240s', delayMs: 240_000 },
  { queue: 'email_retry_480s', delayMs: 480_000 },
];

/** One delivery per retry step, plus the final attempt that dead-letters. */
export const MAX_EMAIL_ATTEMPTS = RETRY_STEPS.length + 1;

/** Coerce a delivery-attempt header value into the 1..MAX range. */
export function attemptOf(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n < 1) {
    return 1;
  }
  return Math.min(n, MAX_EMAIL_ATTEMPTS);
}

/**
 * Ensure that full RMQ topology is in its expected shape
 * before starting to consume events.
 *
 * This is so that misconfigured brokers fail fast.
 */
export async function assertTopology(ch1: amqplib.Channel) {
  await ch1.assertExchange(RETRY_EXCHANGE, 'headers', { durable: true });
  await ch1.assertExchange(DLQ_EXCHANGE, 'direct', { durable: true });
  await ch1.assertExchange(BACK_EXCHANGE, 'direct', { durable: true });
  await ch1.assertQueue(OTP_QUEUE, {
    durable: true,
    arguments: { 'x-queue-type': 'classic' },
  });

  // Check retry queues have expected TTL and DLEs
  for (const step of RETRY_STEPS) {
    await ch1.assertQueue(step.queue, {
      durable: true,
      arguments: {
        'x-queue-type': 'classic',
        'x-dead-letter-exchange': BACK_EXCHANGE,
        'x-message-ttl': step.delayMs,
      },
    });
    // Header binding maps each hop's delay to its parking-lot queue.
    await ch1.bindQueue(step.queue, RETRY_EXCHANGE, '', {
      'x-match': 'all',
      [DELAY_HEADER]: String(step.delayMs),
    });
  }

  await ch1.assertQueue(DLQ_QUEUE, {
    durable: true,
    arguments: { 'x-queue-type': 'classic' },
  });
  await ch1.bindQueue(DLQ_QUEUE, DLQ_EXCHANGE, OTP_EMAIL_ROUTING_KEY);
  await ch1.bindQueue(OTP_QUEUE, BACK_EXCHANGE, OTP_EMAIL_ROUTING_KEY);
}
