import { readFileSync } from 'node:fs';
import { envs } from './utils/envs.ts';
import { logger } from './utils/logger.ts';
import amqplib from 'amqplib';
import { assertTopology, ATTEMPT_HEADER, attemptOf } from './utils/topology.ts';
import type { Listener } from './handlers/types.ts';
import { OtpEmailListener } from './handlers/otp.ts';
import { ResetPasswordEmailListener } from './handlers/password-reset.ts';
import { dispatchOutcome } from './handlers/common/dispatcher.ts';

const RABBITMQ_PASS = readFileSync(envs.RABBITMQ_PASSWORD_FILE, 'utf8').trim();

const brokerUrl =
  `amqp://${encodeURIComponent(envs.RABBITMQ_USER)}:` +
  `${encodeURIComponent(RABBITMQ_PASS)}@` +
  `${envs.RABBITMQ_HOST}:${envs.RABBITMQ_PORT}/${encodeURIComponent(envs.RABBITMQ_VHOST)}`;

const emailListeners: Listener[] = [
  OtpEmailListener,
  ResetPasswordEmailListener,
];

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
let reconnectAttempt = 0;

// A dropped connection (broker restart, network blip) ends every consumer, so start over with backoff.
function scheduleReconnect(reason: unknown) {
  const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** reconnectAttempt++);
  logger.warn(`RabbitMQ unavailable (${String(reason)}); reconnecting in ${delay}ms`);
  setTimeout(() => void start(), delay);
}

async function start(): Promise<void> {
  let conn: Awaited<ReturnType<typeof amqplib.connect>>;
  try {
    conn = await amqplib.connect(brokerUrl);
  } catch (err) {
    scheduleReconnect(err);
    return;
  }

  conn.on('error', (err) => {
    logger.error('Connection error  :' + err);
  });
  conn.on('handler-error', (err, event) => {
    logger.error(`Uncaught exception in connection ${event} listener:` + err);
  });
  conn.on('close', () => scheduleReconnect('connection closed'));

  try {
    const ch1 = await conn.createChannel();
    ch1.on('error', (err) => {
      logger.error('Channel error :' + err);
    });
    ch1.on('handler-error', (err, event) => {
      logger.error(`Uncaught exception in channel ${event} listener:` + err);
    });

    await assertTopology(ch1);

    for (const { queueKey, handler } of emailListeners) {
      await ch1.consume(queueKey, async (msg) => {
        if (msg === null) {
          logger.info('Consumer cancelled by server');
          return;
        }

        const attempt = attemptOf(msg.properties.headers?.[ATTEMPT_HEADER]);
        await dispatchOutcome(
          ch1,
          msg,
          attempt,
          await handler(msg.content, attempt),
        );
      });
    }
  } catch (err) {
    logger.error('RabbitMQ setup failed: ' + err);
    // Closing fires 'close', which schedules the retry.
    await conn.close().catch(() => {});
    return;
  }

  reconnectAttempt = 0;
  logger.info('Consuming email queues');
}

void start();
