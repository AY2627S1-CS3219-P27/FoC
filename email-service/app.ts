import { readFileSync } from 'node:fs';
import nodemailer from 'nodemailer';
import { Redis } from 'ioredis';
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
const redis = new Redis({
  host: envs.REDIS_HOST,
  port: envs.REDIS_PORT,
  username: envs.REDIS_USERNAME,
  db: envs.REDIS_DB_INDEX,
  enableOfflineQueue: false,
});
redis.on('error', (err) => {
  logger.error({ err }, 'Redis connection error');
});

const DEDUP_PREFIX = 'email:seen';
const DEDUP_TTL_SECONDS = 15 * 60;

const brokerUrl =
  `amqp://${encodeURIComponent(envs.RABBITMQ_USER)}:` +
  `${encodeURIComponent(RABBITMQ_PASS)}@` +
  `${envs.RABBITMQ_HOST}:${envs.RABBITMQ_PORT}/${encodeURIComponent(envs.RABBITMQ_VHOST)}`;

export const MAX_OTP_EMAIL_ATTEMPTS = 5;
export const RETRY_BACKOFF_MS: readonly number[] = [
  60_000, 120_000, 240_000, 480_000,
];

/** Header carrying the delivery-attempt counter across republish hops. */
export const ATTEMPT_HEADER = 'x-foc-attempt';

export const RETRY_EXCHANGE = 'foc.retry';
export const DLQ_EXCHANGE = 'foc.dlq';
export const BACK_EXCHANGE = 'foc.back';
export const OTP_QUEUE = 'otp_emails';
export const RETRY_QUEUE = 'otp_emails.retry';
export const DLQ_QUEUE = 'otp_emails.dlq';
export const OTP_EMAIL_ROUTING_KEY = 'otp.email';

/**
 * Queue-level TTL on the retry queue: a safety cap so a republished message
 * without (or past) its per-message expiration cannot sit forever.
 * */
const RETRY_QUEUE_TTL_CAP_MS = RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1];

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

  // Assert the full topology — exchanges, queues and bindings — before
  // consuming, so a misconfigured broker fails fast instead of silently
  // dropping retries and dead-letters. The args must match the
  // rabbitmq/definitions.json seed (assert* errors loudly on mismatch) and
  // binding the routes makes an unroutable publish impossible — a publish
  // with no bound queue would otherwise vanish without a trace.
  await ch1.assertExchange(RETRY_EXCHANGE, 'direct', { durable: true });
  await ch1.assertExchange(DLQ_EXCHANGE, 'direct', { durable: true });
  await ch1.assertExchange(BACK_EXCHANGE, 'direct', { durable: true });
  await ch1.assertQueue(OTP_QUEUE, {
    durable: true,
    arguments: { 'x-queue-type': 'classic' },
  });
  await ch1.assertQueue(RETRY_QUEUE, {
    durable: true,
    arguments: {
      'x-queue-type': 'classic',
      // Items in retry queue die after their TTL and
      // get handed back to the BACK_EXCHANGE which routes it to the
      // main OTP_QUEUE. This allows us to use the same
      // handler for retries.
      'x-dead-letter-exchange': BACK_EXCHANGE,
      'x-message-ttl': RETRY_QUEUE_TTL_CAP_MS,
    },
  });
  await ch1.assertQueue(DLQ_QUEUE, {
    durable: true,
    arguments: { 'x-queue-type': 'classic' },
  });
  await ch1.bindQueue(RETRY_QUEUE, RETRY_EXCHANGE, OTP_EMAIL_ROUTING_KEY);
  await ch1.bindQueue(DLQ_QUEUE, DLQ_EXCHANGE, OTP_EMAIL_ROUTING_KEY);
  await ch1.bindQueue(OTP_QUEUE, BACK_EXCHANGE, OTP_EMAIL_ROUTING_KEY);

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
        // delay as a per-message TTL in the retry queue; the retry queue DLX
        // routes the copy back to `otp_emails` for the next attempt.
        try {
          const published = ch1.publish(
            RETRY_EXCHANGE,
            OTP_EMAIL_ROUTING_KEY,
            msg.content,
            {
              headers: {
                ...msg.properties.headers,
                [ATTEMPT_HEADER]: outcome.nextAttempt,
              },
              expiration: String(outcome.delayMs),
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
            OTP_EMAIL_ROUTING_KEY,
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
        delayMs: RETRY_BACKOFF_MS[attempt - 1],
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
    const result = await redis.set(
      dedupKey(messageId),
      '1',
      'EX',
      DEDUP_TTL_SECONDS,
      'NX',
    );
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
