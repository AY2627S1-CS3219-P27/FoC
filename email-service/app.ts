import { readFileSync } from 'node:fs';
import type { Channel, ChannelModel, RecoveringChannelModel } from 'amqplib';
import amqplib from 'amqplib';
import { envs } from './utils/envs.ts';
import { logger } from './utils/logger.ts';
import { assertTopology, ATTEMPT_HEADER, attemptOf } from './utils/topology.ts';
import type { Listener } from './handlers/types.ts';
import { OtpEmailListener } from './handlers/otp.ts';
import { ResetPasswordEmailListener } from './handlers/password-reset.ts';
import { dispatchOutcome } from './handlers/common/dispatcher.ts';
import { redis } from './handlers/common/redis-client.ts';
import { forgetMessageId } from './handlers/common/dedup.ts';

const RABBITMQ_PASS = readFileSync(envs.RABBITMQ_PASSWORD_FILE, 'utf8').trim();

const brokerUrl =
  `amqp://${encodeURIComponent(envs.RABBITMQ_USER)}:` +
  `${encodeURIComponent(RABBITMQ_PASS)}@` +
  `${envs.RABBITMQ_HOST}:${envs.RABBITMQ_PORT}/${encodeURIComponent(envs.RABBITMQ_VHOST)}`;

const emailListeners: Listener[] = [
  OtpEmailListener,
  ResetPasswordEmailListener,
];

// Recovery backoff mirrors the broker-consumption services (supplier-service,
// credit-service) so a broker restart brings this service back with the same
// pacing: exponential with a 30s cap and a little jitter to avoid thundering.
const RECONNECT_INITIAL_DELAY_MS = 100;
const RECONNECT_MAX_DELAY_MS = 30_000;
const RECONNECT_BACKOFF_FACTOR = 2;
const RECONNECT_BACKOFF_JITTER = 0.2;

// Bound the single connection used by the service. `connection` is the
// recovering model returned by `connect`; `activeModel` is the raw broker model
// currently backing it, captured in `setupConnection` so it can be closed to
// trigger a reconnect (the recovery library only recreates state on reconnect).
let connection: RecoveringChannelModel | undefined;
let activeModel: ChannelModel | undefined;
// Guards against scheduling several closes for one outage; reset in
// setupConnection every time a fresh model takes over.
let recycling = false;

// Hard stop if draining hangs; keep below the container's stop_grace_period.
const SHUTDOWN_TIMEOUT_MS = 8_000;
const RELEASE_TIMEOUT_MS = 1_000;
// Caps unacked deliveries per channel, so shutdown drains a handful, not the whole backlog.
const PREFETCH = 10;
let shuttingDown = false;
let activeChannel: Channel | undefined;
let consumerTags: string[] = [];
// Deliveries still being handled, with their dedup id; shutdown waits for them before closing.
const inFlight = new Map<Promise<void>, string | undefined>();

function messageIdOf(content: Buffer): string | undefined {
  try {
    const id = JSON.parse(content.toString('utf8'))?.data?.messageId;
    return typeof id === 'string' ? id : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Establish topology and consumers on the current broker model. Called once on
 * the initial connection and again after every successful reconnect, so the
 * service re-establishes itself automatically when the broker recovers.
 */
async function setupConnection(model: ChannelModel): Promise<void> {
  // A reconnect racing shutdown must not install consumers nobody will drain.
  if (shuttingDown) {
    return;
  }
  recycling = false;
  activeModel = model;

  const ch1 = await model.createChannel();
  activeChannel = ch1;
  consumerTags = [];
  ch1.on('error', (err) => {
    logger.error('Channel error :' + err);
  });
  ch1.on('handler-error', (err, event) => {
    logger.error(`Uncaught exception in channel ${event} listener:` + err);
  });
  ch1.on('close', () => {
    if (shuttingDown) {
      return;
    }
    logger.error('Channel closed unexpectedly; reconnecting');
    recycleConnection();
  });

  await assertTopology(ch1);
  await ch1.prefetch(PREFETCH);

  for (const { queueKey, handler } of emailListeners) {
    const { consumerTag } = await ch1.consume(queueKey, async (msg) => {
      if (msg === null) {
        // Server-side cancellation (queue deleted or exchange removed) breaks
        // this consumer's redelivery guarantees. Recycle the connection so a
        // fresh consumer is installed once the broker re-connects.
        logger.error('Consumer cancelled by server; reconnecting');
        recycleConnection();
        return;
      }

      const attempt = attemptOf(msg.properties.headers?.[ATTEMPT_HEADER]);
      const delivery = (async () => {
        await dispatchOutcome(
          ch1,
          msg,
          attempt,
          await handler(msg.content, attempt),
        );
      })();
      inFlight.set(delivery, messageIdOf(msg.content));
      try {
        await delivery;
      } finally {
        inFlight.delete(delivery);
      }
    });
    if (shuttingDown) {
      await ch1.cancel(consumerTag).catch(() => undefined);
      return;
    }
    consumerTags.push(consumerTag);
  }
}

/**
 * Clear the dedup marks of deliveries cut off mid-send, so their redelivered
 * copies are sent instead of being acked as duplicates. A send that finished
 * but was not yet acked is then sent twice, which beats a lost OTP.
 */
async function releaseInFlight(): Promise<void> {
  const ids = [...inFlight.values()].filter((id) => id !== undefined);
  await Promise.race([
    Promise.allSettled(ids.map(forgetMessageId)),
    new Promise((resolve) => setTimeout(resolve, RELEASE_TIMEOUT_MS).unref()),
  ]);
}

/**
 * On SIGTERM/SIGINT: stop new deliveries, let in-flight ones finish, then close
 * the broker and Redis connections. Unacked messages are redelivered by the
 * broker; on the hard timeout, releaseInFlight keeps them from being deduped away.
 */
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  logger.info(`Received ${signal}; shutting down`);
  setTimeout(() => {
    logger.error('Shutdown timed out; exiting');
    void releaseInFlight().finally(() => process.exit(1));
  }, SHUTDOWN_TIMEOUT_MS).unref();

  const channel = activeChannel;
  if (channel) {
    await Promise.allSettled(consumerTags.map((tag) => channel.cancel(tag)));
  }
  while (inFlight.size > 0) {
    await Promise.allSettled([...inFlight.keys()]);
  }
  await Promise.allSettled([connection?.close(), redis.close()]);
  logger.info('Shutdown complete');
  process.exit(0);
}

process.once('SIGTERM', (signal) => void shutdown(signal));
process.once('SIGINT', (signal) => void shutdown(signal));

/**
 * Force the recovery library to reconnect: closing the current broker model
 * is observed as a disconnect, and recovery rebuilds topology + consumers via
 * `setupConnection`. Simultaneous failures reconnect once.
 */
function recycleConnection(): void {
  if (recycling || !activeModel) {
    return;
  }
  recycling = true;
  void activeModel.close().catch((err) => {
    logger.error(`Error closing model to trigger reconnect: ${err}`);
  });
}

/** Logs the recovery lifecycle events on the recovering connection model. */
function registerConnectionLogging(conn: RecoveringChannelModel): void {
  conn.on('connect', () => {
    logger.info('Connected to broker');
  });
  conn.on('disconnect', (err) => {
    logger.warn(`Disconnected from broker: ${err.message}`);
  });
  conn.on('reconnect-scheduled', ({ attempt, delay }) => {
    logger.warn(`Reconnect scheduled in ${delay}ms (attempt ${attempt})`);
  });
  conn.on('connect-failed', (err) => {
    logger.error(`Connect attempt failed: ${err.message}`);
  });
  conn.on('reconnect-failed', () => {
    logger.error('Reconnect attempts exhausted');
  });
  conn.on('blocked', (reason) => {
    logger.warn(`Connection blocked: ${reason}`);
  });
  conn.on('unblocked', () => {
    logger.info('Connection unblocked');
  });
  conn.on('error', (err) => {
    logger.error('Connection error :' + err);
  });
  conn.on('handler-error', (err, event) => {
    logger.error(`Uncaught exception in connection ${event} listener:` + err);
  });
}

/** Establishes the recovering AMQP connection and its logging. */
async function start(): Promise<void> {
  connection = await amqplib.connect(brokerUrl, {
    recovery: {
      initialDelay: RECONNECT_INITIAL_DELAY_MS,
      maxDelay: RECONNECT_MAX_DELAY_MS,
      factor: RECONNECT_BACKOFF_FACTOR,
      jitter: RECONNECT_BACKOFF_JITTER,
      maxRetries: Number.POSITIVE_INFINITY,
      setup: setupConnection,
    },
  });

  registerConnectionLogging(connection);
}

void start();
