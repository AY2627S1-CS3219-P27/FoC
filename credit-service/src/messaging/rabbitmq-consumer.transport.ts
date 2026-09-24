import { once } from 'node:events';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  Channel,
  ChannelModel,
  ConfirmChannel,
  ConsumeMessage,
  MessageProperties,
  Options,
  RecoveringChannelModel,
} from 'amqplib';
import type { EnvironmentVariables } from '../config/environment.js';
import { AMQP_CONNECT, type AmqpConnect } from './amqp-connection.provider.js';
import { RABBITMQ_CONNECTION_URL } from './rabbitmq-connection-url.provider.js';
import type {
  PermanentMessageFailure,
  Subscription,
} from './rabbitmq-message.types.js';

const MAX_RETRY_COUNT = 5;
const MAX_FAILURE_REASON_LENGTH = 512;

const TRANSPORT_HEADERS = new Set([
  'x-retry-count',
  'x-event-id',
  'x-failure-category',
  'x-failure-reason',
  'x-failure-timestamp',
]);

type TransportFailureCategory =
  | 'MALFORMED_JSON'
  | 'ROUTING_KEY_MISMATCH'
  | 'INVALID_RETRY_METADATA'
  | 'TRANSIENT_PROCESSING_FAILURE'
  | 'PROCESSING_RETRIES_EXHAUSTED';

interface SharedTopology {
  domainExchange: string;
  retryExchange: string;
  retryReturnExchange: string;
  retryDelays: number[];
  deadLetterExchange: string;
  prefetch: number;
}

interface ResolvedSubscription extends Subscription {
  deadLetterQueue: string;
}

interface ConsumerState {
  channel: Channel;
  consumerTag: string;
  generation: number;
}

interface FailureMetadata {
  category: TransportFailureCategory | PermanentMessageFailure;
  reason: string;
  retryCount: number;
  eventId?: string;
}

interface ConnectionReadiness {
  promise: Promise<void>;
  resolve: () => void;
}

function connectionReadiness(): ConnectionReadiness {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function extractEventId(
  body: unknown,
  properties: MessageProperties,
): string | undefined {
  if (
    typeof body === 'object' &&
    body !== null &&
    'eventId' in body &&
    typeof body.eventId === 'string'
  ) {
    return body.eventId;
  }

  return typeof properties.messageId === 'string'
    ? properties.messageId
    : undefined;
}

function sanitizeFailureReason(reason: string): string {
  const sanitized = reason.replace(/[\r\n\t]+/g, ' ').trim();
  return (sanitized || 'message processing failed').slice(
    0,
    MAX_FAILURE_REASON_LENGTH,
  );
}

function retryCountFrom(message: ConsumeMessage): number | undefined {
  const value = message.properties.headers?.['x-retry-count'];
  if (value === undefined) {
    return 0;
  }

  return Number.isInteger(value) && value >= 0 && value <= MAX_RETRY_COUNT
    ? (value as number)
    : undefined;
}

/**
 * Owns shared RabbitMQ recovery and independently consumed event streams.
 * Every queue receives a dedicated channel, retry chain, and DLQ; publisher
 * confirmation and graceful drainage remain shared by the transport.
 */
@Injectable()
export class RabbitMqConsumerTransport implements OnApplicationShutdown {
  private readonly logger = new Logger(RabbitMqConsumerTransport.name);
  private readonly topology: SharedTopology;
  private readonly rabbitMqUrl: string;
  private readonly subscriptions = new Map<string, ResolvedSubscription>();
  private readonly consumers = new Map<string, ConsumerState>();
  // Tracks work across every stream so shutdown has one drainage boundary
  private readonly inFlight = new Set<Promise<void>>();
  private connection?: RecoveringChannelModel;
  private connectionPromise?: Promise<RecoveringChannelModel>;
  private activeModel?: ChannelModel;
  private publisherChannel?: ConfirmChannel;
  private topologyMutation: Promise<void> = Promise.resolve();
  private connectionReady = connectionReadiness();
  private readinessPending = true;
  private generation = 0;
  private recycling = false;
  private stopping = false;
  private closed = false;

  constructor(
    config: ConfigService<EnvironmentVariables, true>,
    @Inject(RABBITMQ_CONNECTION_URL) rabbitMqUrl: string,
    @Inject(AMQP_CONNECT) private readonly connectAmqp: AmqpConnect,
  ) {
    this.rabbitMqUrl = rabbitMqUrl;
    this.topology = {
      domainExchange: config.getOrThrow('RABBITMQ_EXCHANGE'),
      retryExchange: config.getOrThrow('RABBITMQ_RETRY_EXCHANGE'),
      retryReturnExchange: config.getOrThrow('RABBITMQ_RETRY_RETURN_EXCHANGE'),
      retryDelays: config.getOrThrow('RABBITMQ_RETRY_DELAYS_MS'),
      deadLetterExchange: config.getOrThrow('RABBITMQ_DEAD_LETTER_EXCHANGE'),
      prefetch: config.getOrThrow('RABBITMQ_PREFETCH'),
    };
  }

  async subscribe(subscription: Subscription): Promise<void> {
    if (this.stopping || this.closed) {
      throw new Error('RabbitMQ consumer transport is shutting down');
    }

    const resolved = this.resolveSubscription(subscription);
    this.assertTopologyNamesAvailable(resolved);

    // Register synchronously before the first await. Concurrent callers then
    // observe the reservation and cannot install the same topology twice.
    this.subscriptions.set(resolved.queue, resolved);

    try {
      await this.ensureConnection();
      await this.connectionReady.promise;
      await this.serializeTopologyMutation(async () => {
        if (this.stopping || this.closed) {
          throw new Error('RabbitMQ consumer transport is shutting down');
        }
        if (
          this.consumers.get(resolved.queue)?.generation === this.generation
        ) {
          return;
        }
        if (!this.activeModel || !this.publisherChannel) {
          throw new Error('RabbitMQ consumer connection is not ready');
        }
        await this.installSubscription(
          this.activeModel,
          this.publisherChannel,
          resolved,
          this.generation,
        );
      });
    } catch (error) {
      if (!this.consumers.has(resolved.queue)) {
        this.subscriptions.delete(resolved.queue);
      }
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.stopping = true;
    this.connectionReady.resolve();
    await this.connectionPromise?.catch(() => undefined);

    // A subscription may already be installing when shutdown begins. Wait for
    // that serialized mutation before taking the channel snapshot to cancel.
    await this.topologyMutation;

    const consumerStates = [...this.consumers.values()];
    await Promise.allSettled(
      consumerStates.map(({ channel, consumerTag }) =>
        channel.cancel(consumerTag),
      ),
    );
    await Promise.allSettled(this.inFlight);
    await this.publisherChannel?.waitForConfirms().catch((error) => {
      this.logger.warn(
        `Unable to drain RabbitMQ publisher confirmations: ${String(error)}`,
      );
    });
    await Promise.allSettled(
      consumerStates.map(({ channel }) => channel.close()),
    );
    await this.publisherChannel?.close().catch((error) => {
      this.logger.warn(
        `Unable to close RabbitMQ publisher channel: ${String(error)}`,
      );
    });
    await this.connection?.close().catch((error) => {
      this.logger.warn(`Unable to close RabbitMQ connection: ${String(error)}`);
    });

    this.consumers.clear();
    this.activeModel = undefined;
    this.publisherChannel = undefined;
    this.connection = undefined;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.close();
  }

  private resolveSubscription(
    subscription: Subscription,
  ): ResolvedSubscription {
    this.assertNonEmptyName(subscription.queue, 'queue');
    this.assertNonEmptyName(subscription.routingKey, 'routing key');
    if (subscription.deadLetterQueue !== undefined) {
      this.assertNonEmptyName(
        subscription.deadLetterQueue,
        'dead-letter queue',
      );
    }
    if (this.subscriptions.has(subscription.queue)) {
      throw new Error(
        `RabbitMQ queue ${subscription.queue} is already subscribed`,
      );
    }

    return Object.freeze({
      ...subscription,
      deadLetterQueue:
        subscription.deadLetterQueue ?? `${subscription.queue}.dlq`,
    });
  }

  private assertNonEmptyName(value: string, label: string): void {
    if (value.length === 0 || value.trim() !== value) {
      throw new Error(`RabbitMQ subscription ${label} must be non-empty`);
    }
  }

  private assertTopologyNamesAvailable(candidate: ResolvedSubscription): void {
    const candidateNames = this.subscriptionQueueNames(candidate);
    if (candidateNames.size !== this.topology.retryDelays.length + 2) {
      throw new Error(
        `RabbitMQ subscription ${candidate.queue} contains colliding queue names`,
      );
    }

    const establishedNames = new Set(
      [...this.subscriptions.values()].flatMap((subscription) => [
        ...this.subscriptionQueueNames(subscription),
      ]),
    );
    const collision = [...candidateNames].find((name) =>
      establishedNames.has(name),
    );
    if (collision) {
      throw new Error(`RabbitMQ queue name ${collision} is already in use`);
    }
  }

  private subscriptionQueueNames(
    subscription: ResolvedSubscription,
  ): Set<string> {
    return new Set([
      subscription.queue,
      ...this.topology.retryDelays.map(
        (_, index) => `${subscription.queue}.retry.${index + 1}`,
      ),
      subscription.deadLetterQueue,
    ]);
  }

  private async ensureConnection(): Promise<RecoveringChannelModel> {
    if (!this.connectionPromise) {
      // Every subscription shares this promise, while the recovery library
      // owns reconnect attempts and calls setup for each new broker model.
      this.connectionPromise = this.connectAmqp(this.rabbitMqUrl, {
        recovery: {
          initialDelay: 100,
          maxDelay: 30_000,
          factor: 2,
          jitter: 0.2,
          maxRetries: Number.POSITIVE_INFINITY,
          setup: async (model: ChannelModel) => this.setupConnection(model),
        },
      })
        .then((connection) => {
          this.connection = connection;
          this.registerConnectionLogging(connection);
          return connection;
        })
        .catch((error) => {
          this.connectionPromise = undefined;
          throw error;
        });
    }

    return this.connectionPromise;
  }

  private serializeTopologyMutation<T>(work: () => Promise<T>): Promise<T> {
    // Recovery and live registration both mutate channels. Chaining them
    // keeps those operations ordered without holding a lock while connecting.
    const result = this.topologyMutation.then(work, work);
    this.topologyMutation = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async setupConnection(model: ChannelModel): Promise<void> {
    if (!this.readinessPending) {
      this.connectionReady = connectionReadiness();
      this.readinessPending = true;
    }

    try {
      await this.serializeTopologyMutation(async () => {
        if (this.stopping) {
          return;
        }

        const generation = this.generation + 1;
        this.generation = generation;
        this.recycling = false;
        this.activeModel = model;
        this.consumers.clear();

        // Exchanges and publication confirmations are connection-wide; each
        // subscription receives a separate consumer channel below.
        const publisherChannel = await model.createConfirmChannel();
        this.registerChannelRecovery(
          model,
          publisherChannel,
          'publisher',
          generation,
        );
        this.publisherChannel = publisherChannel;
        await this.declareSharedTopology(publisherChannel);

        for (const subscription of this.subscriptions.values()) {
          await this.installSubscription(
            model,
            publisherChannel,
            subscription,
            generation,
          );
        }
      });
    } catch (error) {
      this.recycling = true;
      const failedConsumers = [...this.consumers.values()].filter(
        ({ generation }) => generation === this.generation,
      );
      await Promise.allSettled(
        failedConsumers.map(({ channel }) => channel.close()),
      );
      await this.publisherChannel?.close().catch(() => undefined);
      this.activeModel = undefined;
      this.publisherChannel = undefined;
      this.consumers.clear();
      throw error;
    } finally {
      this.readinessPending = false;
      this.connectionReady.resolve();
    }
  }

  private async declareSharedTopology(channel: Channel): Promise<void> {
    // Root infrastructure owns the shared domain exchange. A passive check
    // fails startup if it is absent without granting this service permission
    // to create, delete, or alter shared broker infrastructure.
    await channel.checkExchange(this.topology.domainExchange);
    await channel.assertExchange(this.topology.retryExchange, 'direct', {
      durable: true,
    });
    await channel.assertExchange(this.topology.retryReturnExchange, 'direct', {
      durable: true,
    });
    await channel.assertExchange(this.topology.deadLetterExchange, 'direct', {
      durable: true,
    });
  }

  private async installSubscription(
    model: ChannelModel,
    publisherChannel: ConfirmChannel,
    subscription: ResolvedSubscription,
    generation: number,
  ): Promise<void> {
    const channel = await model.createChannel();
    try {
      await this.declareSubscriptionTopology(channel, subscription);
      await channel.prefetch(this.topology.prefetch);
      const reply = await channel.consume(
        subscription.queue,
        (message) => {
          if (message === null) {
            // Broker cancellation invalidates the stream's guarantees. Rebuild
            // every stream together so the registry is installed consistently.
            this.logger.error(
              `RabbitMQ cancelled consumer for ${subscription.queue}`,
            );
            void this.recycleConnection(model, generation);
            return;
          }

          const processing = this.processDelivery(
            message,
            channel,
            publisherChannel,
            subscription,
          ).catch((error) => {
            this.logger.error(
              `RabbitMQ delivery finalization failed for ${subscription.queue}: ${String(error)}`,
            );
          });
          this.inFlight.add(processing);
          void processing.finally(() => this.inFlight.delete(processing));
        },
        { noAck: false },
      );

      this.registerChannelRecovery(
        model,
        channel,
        `consumer ${subscription.queue}`,
        generation,
      );

      this.consumers.set(subscription.queue, {
        channel,
        consumerTag: reply.consumerTag,
        generation,
      });
    } catch (error) {
      await channel.close().catch(() => undefined);
      throw error;
    }
  }

  private async declareSubscriptionTopology(
    channel: Channel,
    subscription: ResolvedSubscription,
  ): Promise<void> {
    await channel.assertQueue(subscription.queue, { durable: true });
    await channel.bindQueue(
      subscription.queue,
      this.topology.domainExchange,
      subscription.routingKey,
    );
    // Returned retries use queue identity, not the shared domain key. This
    // guarantees that one stream's retry cannot fan out to sibling queues.
    await channel.bindQueue(
      subscription.queue,
      this.topology.retryReturnExchange,
      subscription.queue,
    );

    for (const [index, delay] of this.topology.retryDelays.entries()) {
      const retryQueue = `${subscription.queue}.retry.${index + 1}`;
      // Retry queues are delay buckets. Expiry dead-letters the original bytes
      // through the service-owned return exchange directly to this main queue.
      await channel.assertQueue(retryQueue, {
        durable: true,
        messageTtl: delay,
        deadLetterExchange: this.topology.retryReturnExchange,
        deadLetterRoutingKey: subscription.queue,
      });
      await channel.bindQueue(
        retryQueue,
        this.topology.retryExchange,
        retryQueue,
      );
    }

    await channel.assertQueue(subscription.deadLetterQueue, { durable: true });
    await channel.bindQueue(
      subscription.deadLetterQueue,
      this.topology.deadLetterExchange,
      subscription.deadLetterQueue,
    );
  }

  private async processDelivery(
    message: ConsumeMessage,
    consumerChannel: Channel,
    publisherChannel: ConfirmChannel,
    subscription: ResolvedSubscription,
  ): Promise<void> {
    // Transport-level failures never enter application code. Valid decoded
    // messages alone reach the subscription handler.
    let body: unknown;
    try {
      body = JSON.parse(message.content.toString('utf8')) as unknown;
    } catch {
      await this.deadLetterOrRequeue(
        message,
        consumerChannel,
        publisherChannel,
        subscription,
        {
          category: 'MALFORMED_JSON',
          reason: 'message body is not valid JSON',
          retryCount: 0,
          eventId:
            typeof message.properties.messageId === 'string'
              ? message.properties.messageId
              : undefined,
        },
      );
      return;
    }

    const eventId = extractEventId(body, message.properties);
    const retryCount = retryCountFrom(message);
    if (retryCount === undefined) {
      await this.deadLetterOrRequeue(
        message,
        consumerChannel,
        publisherChannel,
        subscription,
        {
          category: 'INVALID_RETRY_METADATA',
          reason: 'x-retry-count must be an integer from 0 through 5',
          retryCount: 0,
          eventId,
        },
      );
      return;
    }

    // RabbitMQ exposes the exchange and routing key used for the latest route.
    // The retry header selects which physical route is valid for this attempt.
    const validInitialRoute =
      retryCount === 0 &&
      message.fields.exchange === this.topology.domainExchange &&
      message.fields.routingKey === subscription.routingKey;
    const validRetryRoute =
      retryCount > 0 &&
      message.fields.exchange === this.topology.retryReturnExchange &&
      message.fields.routingKey === subscription.queue;

    if (!validInitialRoute && !validRetryRoute) {
      await this.deadLetterOrRequeue(
        message,
        consumerChannel,
        publisherChannel,
        subscription,
        {
          category: 'ROUTING_KEY_MISMATCH',
          reason: 'message route does not match the consumer contract',
          retryCount,
          eventId,
        },
      );
      return;
    }

    try {
      const result = await subscription.handler.handle({
        body,
        rawBody: Buffer.from(message.content),
        // Application handlers always see the logical domain route, regardless
        // of whether RabbitMQ delivered an initial attempt or a returned retry.
        routingKey: subscription.routingKey,
        eventId,
        retryCount,
      });

      if (result.outcome === 'ack') {
        // A handler returns ack only after its own durable work has completed.
        consumerChannel.ack(message);
        return;
      }

      await this.deadLetterOrRequeue(
        message,
        consumerChannel,
        publisherChannel,
        subscription,
        {
          category: result.category,
          reason: result.reason,
          retryCount,
          eventId: result.eventId ?? eventId,
        },
      );
    } catch (error) {
      this.logger.warn(
        `Transient RabbitMQ handler failure for event ${eventId ?? 'unknown'} on attempt ${retryCount + 1}: ${error instanceof Error ? error.name : 'Error'}`,
      );

      if (retryCount < MAX_RETRY_COUNT) {
        await this.retryOrRequeue(
          message,
          consumerChannel,
          publisherChannel,
          subscription,
          retryCount + 1,
          eventId,
        );
        return;
      }

      await this.deadLetterOrRequeue(
        message,
        consumerChannel,
        publisherChannel,
        subscription,
        {
          category: 'PROCESSING_RETRIES_EXHAUSTED',
          reason: 'message processing failed after five retries',
          retryCount,
          eventId,
        },
      );
    }
  }

  private async retryOrRequeue(
    message: ConsumeMessage,
    consumerChannel: Channel,
    publisherChannel: ConfirmChannel,
    subscription: ResolvedSubscription,
    retryCount: number,
    eventId?: string,
  ): Promise<void> {
    const retryQueue = `${subscription.queue}.retry.${retryCount}`;
    try {
      await this.publishConfirmed(
        publisherChannel,
        this.topology.retryExchange,
        retryQueue,
        message.content,
        this.publishOptions(message, {
          category: 'TRANSIENT_PROCESSING_FAILURE',
          reason: 'transient message processing failure',
          retryCount,
          eventId,
        }),
      );
      // Remove the original only after the broker has accepted its replacement.
      consumerChannel.ack(message);
    } catch (error) {
      this.logger.error(
        `Unable to confirm retry publication for event ${eventId ?? 'unknown'}: ${String(error)}`,
      );
      this.requeue(message, consumerChannel);
    }
  }

  private async deadLetterOrRequeue(
    message: ConsumeMessage,
    consumerChannel: Channel,
    publisherChannel: ConfirmChannel,
    subscription: ResolvedSubscription,
    failure: FailureMetadata,
  ): Promise<void> {
    try {
      await this.publishConfirmed(
        publisherChannel,
        this.topology.deadLetterExchange,
        subscription.deadLetterQueue,
        message.content,
        this.publishOptions(message, failure),
      );
      // This ordering prevents a permanent failure from disappearing between
      // its source queue and DLQ.
      consumerChannel.ack(message);
      this.logger.warn(
        `Dead-lettered event ${failure.eventId ?? 'unknown'} from ${subscription.queue}: ${failure.category}`,
      );
    } catch (error) {
      this.logger.error(
        `Unable to confirm dead-letter publication for event ${failure.eventId ?? 'unknown'}: ${String(error)}`,
      );
      this.requeue(message, consumerChannel);
    }
  }

  private publishOptions(
    message: ConsumeMessage,
    failure: FailureMetadata,
  ): Options.Publish {
    const properties = message.properties;
    const preservedHeaders = Object.fromEntries(
      Object.entries(properties.headers ?? {}).filter(
        ([name]) => !TRANSPORT_HEADERS.has(name),
      ),
    );
    const headers: Record<string, unknown> = {
      ...preservedHeaders,
      'x-retry-count': failure.retryCount,
      'x-failure-category': failure.category,
      'x-failure-reason': sanitizeFailureReason(failure.reason),
      'x-failure-timestamp': new Date().toISOString(),
    };
    if (failure.eventId) {
      headers['x-event-id'] = failure.eventId;
    }

    return {
      persistent: true,
      contentType:
        typeof properties.contentType === 'string'
          ? properties.contentType
          : 'application/json',
      contentEncoding:
        typeof properties.contentEncoding === 'string'
          ? properties.contentEncoding
          : undefined,
      priority:
        typeof properties.priority === 'number'
          ? properties.priority
          : undefined,
      correlationId:
        typeof properties.correlationId === 'string'
          ? properties.correlationId
          : undefined,
      replyTo:
        typeof properties.replyTo === 'string' ? properties.replyTo : undefined,
      messageId:
        failure.eventId ??
        (typeof properties.messageId === 'string'
          ? properties.messageId
          : undefined),
      timestamp:
        typeof properties.timestamp === 'number'
          ? properties.timestamp
          : undefined,
      type: typeof properties.type === 'string' ? properties.type : undefined,
      userId:
        typeof properties.userId === 'string' ? properties.userId : undefined,
      appId:
        typeof properties.appId === 'string' ? properties.appId : undefined,
      headers,
    };
  }

  private async publishConfirmed(
    channel: ConfirmChannel,
    exchange: string,
    routingKey: string,
    content: Buffer,
    options: Options.Publish,
  ): Promise<void> {
    // Broker confirmation establishes durability; drain establishes that the
    // client socket accepted any buffered bytes. Both are required for success.
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
        content,
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

  private requeue(message: ConsumeMessage, channel: Channel): void {
    try {
      channel.nack(message, false, true);
    } catch {
      // A closed channel automatically returns unacknowledged deliveries.
    }
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

  private async recycleConnection(
    model: ChannelModel,
    generation: number,
  ): Promise<void> {
    // Only callbacks from the active generation may trigger recovery. Closing
    // stale channels is therefore harmless, and simultaneous failures coalesce.
    if (this.stopping || generation !== this.generation || this.recycling) {
      return;
    }

    this.recycling = true;
    if (!this.readinessPending) {
      this.connectionReady = connectionReadiness();
      this.readinessPending = true;
    }
    this.activeModel = undefined;
    this.publisherChannel = undefined;
    this.consumers.clear();
    await model.close().catch(() => undefined);
  }
}
