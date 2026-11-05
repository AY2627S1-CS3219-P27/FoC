import { readFileSync } from 'node:fs';
import type { ChannelModel, RecoveringChannelModel } from 'amqplib';
import amqplib from 'amqplib';
import { envs } from './utils/envs.ts';
import { logger } from './utils/logger.ts';
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

/**
 * Establish topology and consumers on the current broker model. Called once on
 * the initial connection and again after every successful reconnect, so the
 * service re-establishes itself automatically when the broker recovers.
 */
async function setupConnection(model: ChannelModel): Promise<void> {
  recycling = false;
  activeModel = model;

  const ch1 = await model.createChannel();
  ch1.on('error', (err) => {
    logger.error('Channel error :' + err);
  });
  ch1.on('handler-error', (err, event) => {
    logger.error(`Uncaught exception in channel ${event} listener:` + err);
  });
  ch1.on('close', () => {
    logger.error('Channel closed unexpectedly; reconnecting');
    recycleConnection();
  });

  await assertTopology(ch1);

  for (const { queueKey, handler } of emailListeners) {
    ch1.consume(queueKey, async (msg) => {
      if (msg === null) {
        // Server-side cancellation (queue deleted or exchange removed) breaks
        // this consumer's redelivery guarantees. Recycle the connection so a
        // fresh consumer is installed once the broker re-connects.
        logger.error('Consumer cancelled by server; reconnecting');
        recycleConnection();
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
}

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
