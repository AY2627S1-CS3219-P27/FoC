import { once } from 'node:events';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type {
  Channel,
  ChannelModel,
  ConfirmChannel,
  ConsumeMessage,
  Options,
  RecoveringChannelModel,
} from 'amqplib';
import { NotifyHandler } from '../notifications/notify.handler.js';
import { AMQP_CONNECT, type AmqpConnect } from './amqp-connection.provider.js';
import type {
  NotifyMessagePublisher,
  NotifyRetryMessage,
} from './process-outcome.js';
import { RABBITMQ_CONNECTION_URL } from './rabbitmq-connection-url.provider.js';
import {
  assertTopology,
  ATTEMPT_HEADER,
  CONSUMER_PREFETCH,
  DEAD_LETTER_EXCHANGE,
  DELAY_HEADER,
  NOTIFY_QUEUE,
  NOTIFY_RETRY_ROUTING_KEY,
  RETRY_EXCHANGE,
  attemptOf,
  retryDelayFor,
} from './topology.js';

const RECONNECT_INITIAL_DELAY_MS = 100;
const RECONNECT_MAX_DELAY_MS = 30_000;
const RECONNECT_BACKOFF_FACTOR = 2;
const RECONNECT_BACKOFF_JITTER = 0.2;

/**
 * Owns the notification intake stream: one recovering AMQP connection, one
 * consumer channel and one publisher channel (confirm mode).
 *
 * Broker mechanics live here; the handler only sees the decoded body, its
 * routing key, the attempt counter, and a publisher for per-pair retries and
 * dead-letters. Poison messages are dropped without requeue; unexpected
 * handler errors are requeued so a transient failure is retried by the broker.
 */
@Injectable()
export class NotifyConsumer
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(NotifyConsumer.name);
  private readonly inFlight = new Set<Promise<void>>();

  private connection?: RecoveringChannelModel;
  private activeModel?: ChannelModel;
  private consumerChannel?: Channel;
  private publisherChannel?: ConfirmChannel;
  private consumerTag?: string;
  private generation = 0;
  private recycling = false;
  private stopping = false;
  private closed = false;

  private readonly publisher: NotifyMessagePublisher = {
    publishNotifyRetry: (message, nextAttempt) =>
      this.publishNotifyRetry(message, nextAttempt),
    publishDeadLetter: (message, routingKey, reason) =>
      this.publishDeadLetter(message, routingKey, reason),
  };

  constructor(
    @Inject(RABBITMQ_CONNECTION_URL) private readonly rabbitMqUrl: string,
    @Inject(AMQP_CONNECT) private readonly connectAmqp: AmqpConnect,
    private readonly handler: NotifyHandler,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.connection = await this.connectAmqp(this.rabbitMqUrl, {
      recovery: {
        initialDelay: RECONNECT_INITIAL_DELAY_MS,
        maxDelay: RECONNECT_MAX_DELAY_MS,
        factor: RECONNECT_BACKOFF_FACTOR,
        jitter: RECONNECT_BACKOFF_JITTER,
        maxRetries: Number.POSITIVE_INFINITY,
        setup: (model: ChannelModel) => this.setup(model),
      },
    });

    this.registerConnectionLogging(this.connection);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.close();
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.stopping = true;

    if (this.consumerChannel && this.consumerTag) {
      await this.consumerChannel
        .cancel(this.consumerTag)
        .catch(() => undefined);
    }
    await Promise.allSettled(this.inFlight);
    await this.publisherChannel?.waitForConfirms().catch(() => undefined);
    await this.consumerChannel?.close().catch(() => undefined);
    await this.publisherChannel?.close().catch(() => undefined);
    await this.connection?.close().catch(() => undefined);

    this.consumerChannel = undefined;
    this.publisherChannel = undefined;
    this.activeModel = undefined;
  }

  /** Installs topology and the consumer on a fresh broker model. */
  private async setup(model: ChannelModel): Promise<void> {
    if (this.stopping) {
      return;
    }

    const generation = this.generation + 1;
    this.generation = generation;
    this.recycling = false;
    this.activeModel = model;

    const publisher = await model.createConfirmChannel();
    this.publisherChannel = publisher;
    this.registerChannelRecovery(model, publisher, 'publisher', generation);

    const channel = await model.createChannel();
    this.consumerChannel = channel;
    this.registerChannelRecovery(model, channel, 'consumer', generation);

    await assertTopology(channel);
    await channel.prefetch(CONSUMER_PREFETCH);

    const reply = await channel.consume(
      NOTIFY_QUEUE,
      (message) => {
        if (message === null) {
          // Broker-side cancellation invalidates this consumer's guarantees.
          this.logger.error(
            `Consumer cancelled for ${NOTIFY_QUEUE}; reconnecting`,
          );
          void this.recycleConnection(model, generation);
          return;
        }

        const processing = this.process(message, channel).catch((error) => {
          this.logger.error(
            `Delivery finalization failed for ${NOTIFY_QUEUE}: ${String(error)}`,
          );
        });
        this.inFlight.add(processing);
        void processing.finally(() => this.inFlight.delete(processing));
      },
      { noAck: false },
    );

    this.consumerTag = reply.consumerTag;
    this.logger.log(`Consuming ${NOTIFY_QUEUE}`);
  }

  private async process(
    message: ConsumeMessage,
    channel: Channel,
  ): Promise<void> {
    let body: unknown;
    try {
      body = JSON.parse(message.content.toString('utf8')) as unknown;
    } catch {
      this.logger.warn('Dropping malformed JSON delivery');
      channel.nack(message, false, false);
      return;
    }

    const attempt = attemptOf(message.properties.headers?.[ATTEMPT_HEADER]);
    if (attempt === undefined) {
      this.logger.warn('Dropping delivery with invalid attempt metadata');
      channel.nack(message, false, false);
      return;
    }

    let outcome;
    try {
      outcome = await this.handler.handle(
        {
          body,
          routingKey: message.fields.routingKey,
          attempt,
        },
        this.publisher,
      );
    } catch (error) {
      // Transient failure (e.g. database unavailable): leave the message
      // unacknowledged so the broker redelivers it.
      this.logger.error(
        `Handler failed for ${message.fields.routingKey}: ${String(error)}`,
      );
      channel.nack(message, false, true);
      return;
    }

    if (outcome.action === 'acked') {
      channel.ack(message);
      return;
    }

    this.logger.warn(`Dropping poison message: ${outcome.reason}`);
    channel.nack(message, false, false);
  }

  private async publishNotifyRetry(
    message: NotifyRetryMessage,
    nextAttempt: number,
  ): Promise<void> {
    await this.publishConfirmed(
      RETRY_EXCHANGE,
      NOTIFY_RETRY_ROUTING_KEY,
      message,
      {
        persistent: true,
        contentType: 'application/json',
        headers: {
          [ATTEMPT_HEADER]: nextAttempt,
          [DELAY_HEADER]: String(retryDelayFor(nextAttempt)),
        },
      },
    );
  }

  private async publishDeadLetter(
    message: unknown,
    routingKey: string,
    reason: string,
  ): Promise<void> {
    await this.publishConfirmed(DEAD_LETTER_EXCHANGE, routingKey, message, {
      persistent: true,
      contentType: 'application/json',
      headers: {
        'x-failure-reason': reason.slice(0, 512),
        'x-failure-timestamp': new Date().toISOString(),
      },
    });
  }

  private async publishConfirmed(
    exchange: string,
    routingKey: string,
    body: unknown,
    options: Options.Publish,
  ): Promise<void> {
    const channel = this.publisherChannel;
    if (!channel) {
      throw new Error('RabbitMQ publisher channel is not ready');
    }

    let resolveConfirmation!: () => void;
    let rejectConfirmation!: (error: unknown) => void;
    const confirmation = new Promise<void>((resolve, reject) => {
      resolveConfirmation = resolve;
      rejectConfirmation = reject;
    });

    let writable: boolean;
    try {
      writable = channel.publish(
        exchange,
        routingKey,
        Buffer.from(JSON.stringify(body)),
        options,
        (error) => {
          if (error) {
            rejectConfirmation(error);
          } else {
            resolveConfirmation();
          }
        },
      );
    } catch (error) {
      rejectConfirmation(error);
      writable = true;
    }

    const drained = writable ? Promise.resolve() : once(channel, 'drain');
    await Promise.all([confirmation, drained]);
  }

  private registerConnectionLogging(connection: RecoveringChannelModel): void {
    connection.on('connect', () => this.logger.log('RabbitMQ connected'));
    connection.on('disconnect', (error) =>
      this.logger.warn(`RabbitMQ disconnected: ${error.message}`),
    );
    connection.on('reconnect-scheduled', ({ attempt, delay }) =>
      this.logger.warn(`RabbitMQ reconnect ${attempt} scheduled in ${delay}ms`),
    );
    connection.on('blocked', (reason) =>
      this.logger.warn(`RabbitMQ connection blocked: ${reason}`),
    );
    connection.on('unblocked', () =>
      this.logger.log('RabbitMQ connection unblocked'),
    );
    connection.on('error', (error) =>
      this.logger.error(`RabbitMQ connection error: ${error.message}`),
    );
    connection.on('handler-error', (error, eventName) =>
      this.logger.error(
        `RabbitMQ ${eventName} listener failed: ${error.message}`,
      ),
    );
  }

  private registerChannelRecovery(
    model: ChannelModel,
    channel: Channel,
    name: string,
    generation: number,
  ): void {
    channel.on('error', (error) =>
      this.logger.error(`RabbitMQ ${name} channel error: ${error.message}`),
    );
    channel.on('handler-error', (error, eventName) =>
      this.logger.error(
        `RabbitMQ ${name} channel ${eventName} listener failed: ${error.message}`,
      ),
    );
    channel.on('close', () => {
      if (!this.stopping && generation === this.generation) {
        this.logger.warn(`RabbitMQ ${name} channel closed unexpectedly`);
        void this.recycleConnection(model, generation);
      }
    });
  }

  /** Closes the active model so the recovery library rebuilds the stream. */
  private async recycleConnection(
    model: ChannelModel,
    generation: number,
  ): Promise<void> {
    if (this.stopping || generation !== this.generation || this.recycling) {
      return;
    }

    this.recycling = true;
    this.activeModel = undefined;
    this.consumerChannel = undefined;
    this.publisherChannel = undefined;
    this.consumerTag = undefined;
    await model.close().catch(() => undefined);
  }
}
