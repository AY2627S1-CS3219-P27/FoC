import { readFileSync } from 'node:fs';
import nodemailer from 'nodemailer';
import { createClient } from 'redis';
import { renderOtpEmail } from './templates/otp.ts';
import amqplib from 'amqplib';
import { logger } from './logger.ts';
import { envs, parseOtpEmailMessageBuffer } from './validator.ts';

const SMTP_PASS = readFileSync(envs.SMTP_PASS_FILE, 'utf8').trim();
const RABBITMQ_PASS = readFileSync(envs.RABBITMQ_PASSWORD_FILE, 'utf8').trim();

const transport = nodemailer.createTransport({
  host: envs.SMTP_HOST,
  port: envs.SMTP_PORT,
  secure: envs.SMTP_SECURE,
  auth: {
    user: envs.SMTP_USER,
    pass: SMTP_PASS,
  },
});

// Redis store for dedup/idempotency
const redis = createClient({
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

const DEDUP_PREFIX = 'email:seen';
const DEDUP_TTL_SECONDS = 15 * 60;

const brokerUrl =
  `amqp://${encodeURIComponent(envs.RABBITMQ_USER)}:` +
  `${encodeURIComponent(RABBITMQ_PASS)}@` +
  `${envs.RABBITMQ_HOST}:${envs.RABBITMQ_PORT}/${encodeURIComponent(envs.RABBITMQ_VHOST)}`;

/** One generic parking-lot queue per backoff hop, shared by every message type the email service handles (OTP today, others later). */
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
export const MAX_OTP_EMAIL_ATTEMPTS = RETRY_STEPS.length + 1;

/** Header carrying the delivery-attempt counter across republish hops. */
export const ATTEMPT_HEADER = 'x-foc-attempt';

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

export const RETRY_EXCHANGE = 'foc.retry';
export const DLQ_EXCHANGE = 'foc.dlq';
export const BACK_EXCHANGE = 'foc.back';
export const OTP_QUEUE = 'otp_emails';
export const DLQ_QUEUE = 'otp_emails.dlq';
export const OTP_EMAIL_ROUTING_KEY = 'otp.email';

/** Coerce a delivery-attempt header value into the 1..MAX range. */
export function attemptOf(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n < 1) {
    return 1;
  }
  return Math.min(n, MAX_OTP_EMAIL_ATTEMPTS);
}

(async () => {
  const conn = await amqplib.connect(brokerUrl);

  conn.on('error', (err) => {
    logger.error('Connection error  :' + err);
  });
  conn.on('handler-error', (err, event) => {
    logger.error(`Uncaught exception in connection ${event} listener:` + err);
  });

  const ch1 = await conn.createChannel();
  ch1.on('error', (err) => {
    logger.error('Channel error :' + err);
  });
  ch1.on('handler-error', (err, event) => {
    logger.error(`Uncaught exception in channel ${event} listener:` + err);
  });

  await assertTopology(ch1);

  // Listener
  ch1.consume(OTP_QUEUE, async (msg) => {
    if (msg === null) {
      logger.info('Consumer cancelled by server');
      return;
    }

    const attempt = attemptOf(msg.properties.headers?.[ATTEMPT_HEADER]);
    const outcome = await processOtpEmailMessage(msg.content, attempt);

    switch (outcome.action) {
      case 'acked':
        ch1.ack(msg);
        break;
      case 'dropped':
        // Poison message: drop without requeue rather than redeliver forever.
        ch1.nack(msg, false, false);
        break;
      case 'retry': {
        // Re-enter the retry loop with the next attempt number and this hop's
        // delay in the foc-delay header. foc.retry (headers exchange) routes
        // the copy into the matching parking-lot queue, whose x-message-ttl
        // expiries it and dead-letters it back to foc.back; foc.back routes it
        // to `otp_emails` by the preserved routing key for the next attempt.
        try {
          const published = ch1.publish(
            RETRY_EXCHANGE,
            msg.fields.routingKey,
            msg.content,
            {
              headers: {
                ...msg.properties.headers,
                [ATTEMPT_HEADER]: outcome.nextAttempt,
                [DELAY_HEADER]: String(outcome.delayMs),
              },
              persistent: true,
            },
          );
          if (!published) {
            throw new Error('retry publish not buffered');
          }
          ch1.ack(msg);
        } catch (err) {
          // Publish threw or returned false (unbuffered): requeue the original
          // (headers preserved) so it is not lost; the attempt counter
          // survives the requeue.
          logger.error({ err, attempt }, 'Retry publish failed');
          ch1.nack(msg, false, true);
        }
        break;
      }
      case 'dead-letter': {
        try {
          const published = ch1.publish(
            DLQ_EXCHANGE,
            msg.fields.routingKey,
            msg.content,
            {
              headers: msg.properties.headers,
              persistent: true,
            },
          );
          if (!published) {
            throw new Error('dead-letter publish not buffered');
          }
          ch1.ack(msg);
        } catch (err) {
          logger.error({ err, attempt }, 'Dead-letter publish failed');
          ch1.nack(msg, false, true);
        }
        break;
      }
    }
  });
})();

// Outcome of email process.
// Retry has additional delay/attempt data.
export type ProcessOutcome =
  | { readonly action: 'acked' }
  | { readonly action: 'dropped' }
  | {
      readonly action: 'retry';
      readonly delayMs: number;
      readonly nextAttempt: number;
    }
  | { readonly action: 'dead-letter' };

/**
 * Validate, deduplicate and send one `otp_emails` message. `attempt` is the
 * 1-based delivery attempt, taken from the `x-foc-attempt` header.
 */
export async function processOtpEmailMessage(
  body: Buffer,
  attempt = 1,
): Promise<ProcessOutcome> {
  let data;
  try {
    data = parseOtpEmailMessageBuffer(body);
  } catch (err) {
    logger.error({ err }, 'Invalid otp_emails message');
    return { action: 'dropped' };
  }

  if (await isDuplicate(data.messageId)) {
    return { action: 'acked' };
  }

  const { html, text } = renderOtpEmail({
    otp: data.otp,
    expiresInMinutes: data.expiry,
  });

  try {
    await sendEmail(data.recipient, data.subject, text, html);
    return { action: 'acked' };
  } catch (err) {
    logger.error({ err, attempt }, 'Email send failed');

    // Forget the id so the retried copy of this genuinely-unsent email is not
    // suppressed by the dedup store.
    await forgetMessageId(data.messageId);

    if (attempt < MAX_OTP_EMAIL_ATTEMPTS) {
      return {
        action: 'retry',
        delayMs: RETRY_STEPS[attempt - 1].delayMs,
        nextAttempt: attempt + 1,
      };
    }
    return { action: 'dead-letter' };
  }
}

async function sendEmail(
  recipient: string,
  subject: string,
  text: string,
  html?: string,
) {
  return transport.sendMail({
    from: envs.SMTP_FROM_EMAIL,
    to: recipient,
    subject: subject,
    text,
    html,
  });
}

function dedupKey(messageId: string): string {
  return `${DEDUP_PREFIX}:${messageId}`;
}

/**
 * Atomic check-and-mark in one round trip: SET NX returns 'OK' when the id
 * was newly recorded (not a duplicate) and null when it was already present.
 * Fail-open: an unavailable store is treated as "not seen" so the send is
 * still attempted.
 */
async function isDuplicate(messageId: string): Promise<boolean> {
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
async function forgetMessageId(messageId: string): Promise<void> {
  try {
    await redis.del(dedupKey(messageId));
  } catch (err) {
    logger.warn({ err }, 'Failed to clear dedup mark');
  }
}

/**
 * Ensure that full RMQ topology is in its expected shape
 * before starting to consume events.
 *
 * This is so that misconfigured brokers fail fast.
 */
async function assertTopology(ch1: amqplib.Channel) {
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
