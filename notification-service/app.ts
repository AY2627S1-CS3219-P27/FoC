// Boot order matters: initTelemetry must run before any instrumented module
// (amqplib, node:http under fastify, pino) is evaluated, or the OpenTelemetry
// hooks never apply. Instrumented modules are therefore imported dynamically
// inside main() — the same ESM ordering rule order-service's main.ts follows.
// Static type imports are fine: they are erased at runtime.
import type { ChannelModel, RecoveringChannelModel } from 'amqplib';
import { createRequire } from 'node:module';
import { initTelemetry, registerShutdown } from '@foc/observability';
import { envs } from './utils/envs.ts';
import type { Listener } from './handlers/types.ts';

// Recovery backoff mirrors email-service (and the broker-consumption core
// services) so a broker restart brings this service back with the same
// pacing: exponential with a 30s cap and a little jitter to avoid thundering.
const RECONNECT_INITIAL_DELAY_MS = 100;
const RECONNECT_MAX_DELAY_MS = 30_000;
const RECONNECT_BACKOFF_FACTOR = 2;
const RECONNECT_BACKOFF_JITTER = 0.2;

async function main(): Promise<void> {
  const telemetry = initTelemetry({ serviceName: 'notification-service' });

  // Instrumented modules load only after the SDK has registered (see the
  // ordering note above). Note: amqplib (and later pg) must come through
  // createRequire, not an ESM import — see utils/logger.ts for why.
  const req = createRequire(import.meta.url);
  const [
    { readFileSync },
    { logger },
    { assertTopology },
    { buildServer },
  ] = await Promise.all([
    import('node:fs'),
    import('./utils/logger.ts'),
    import('./utils/topology.ts'),
    import('./http/server.ts'),
  ]);
  const amqplib = req('amqplib') as typeof import('amqplib');

  const RABBITMQ_PASS = readFileSync(envs.RABBITMQ_PASSWORD_FILE, 'utf8').trim();

  const brokerUrl =
    `amqp://${encodeURIComponent(envs.RABBITMQ_USER)}:` +
    `${encodeURIComponent(RABBITMQ_PASS)}@` +
    `${envs.RABBITMQ_HOST}:${envs.RABBITMQ_PORT}/${encodeURIComponent(envs.RABBITMQ_VHOST)}`;

  /**
   * Intake listeners are registered here as their queue topology lands; the
   * scaffold starts with none, so the service connects, asserts (no-op)
   * topology and idles on the broker with its HTTP surface up.
   */
  const listeners: Listener[] = [];

  // Bound the single connection used by the service. `connection` is the
  // recovering model returned by `connect`; `activeModel` is the raw broker
  // model currently backing it, captured in `setupConnection` so it can be
  // closed to trigger a reconnect (the recovery library only recreates state
  // on reconnect).
  let connection: RecoveringChannelModel | undefined;
  let activeModel: ChannelModel | undefined;
  // Guards against scheduling several closes for one outage; reset in
  // setupConnection every time a fresh model takes over.
  let recycling = false;

  /**
   * Establish topology and consumers on the current broker model. Called once
   * on the initial connection and again after every successful reconnect, so
   * the service re-establishes itself automatically when the broker recovers.
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

    for (const { queueKey, handler } of listeners) {
      ch1.consume(queueKey, async (msg) => {
        if (msg === null) {
          // Server-side cancellation (queue deleted or exchange removed)
          // breaks this consumer's redelivery guarantees. Recycle the
          // connection so a fresh consumer is installed once the broker
          // re-connects.
          logger.error('Consumer cancelled by server; reconnecting');
          recycleConnection();
          return;
        }

        await handler(msg.content);
      });
    }
  }

  /**
   * Force the recovery library to reconnect: closing the current broker model
   * is observed as a disconnect, and recovery rebuilds topology + consumers
   * via `setupConnection`. Simultaneous failures reconnect once.
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

  // Establishes the recovering AMQP connection and its logging.
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

  const app = buildServer();
  await app.listen({ port: envs.PORT, host: '0.0.0.0' });
  logger.info(`HTTP server listening on port ${envs.PORT}`);

  // On SIGINT/SIGTERM: drain the HTTP server (and, once the DB layer is
  // imported at boot, close its pool), then flush and stop the telemetry SDK
  // so the last spans and log records actually reach the collector.
  registerShutdown(
    {
      close: async () => {
        await app.close();
      },
    },
    telemetry,
  );
}

void main();
