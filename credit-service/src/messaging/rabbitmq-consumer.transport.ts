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
import type {
  PermanentMessageFailure,
  RabbitMqMessageHandler,
} from './rabbitmq-message.types.js';

const MAX_RETRY_COUNT = 5;
const MAX_FAILURE_REASON_LENGTH = 512;

// These headers belong to the transport. Removing inbound values prevents a
// publisher from spoofing retry state or stale failure diagnostics.
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

interface TopologyConfiguration {
  domainExchange: string;
  mainQueue: string;
  routingKey: string;
  retryExchange: string;
  retryDelays: number[];
  deadLetterExchange: string;
  deadLetterQueue: string;
  prefetch: number;
}

interface FailureMetadata {
  category: TransportFailureCategory | PermanentMessageFailure;
  reason: string;
  retryCount: number;
  eventId?: string;
}

function extractEventId(
  body: unknown,
  properties: MessageProperties,
): string | undefined {
  // This is correlation only, not contract validation. Still need to validate 
  // the decoded envelope before any business or persistence operation.
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
  // Missing means the initial attempt. Rejecting malformed counters prevents
  // an attacker or broken publisher from bypassing the bounded retry policy.
  const value = message.properties.headers?.['x-retry-count'];
  if (value === undefined) {
    return 0;
  }

  return Number.isInteger(value) && value >= 0 && value <= MAX_RETRY_COUNT
    ? (value as number)
    : undefined;
}

/**
 * Owns RabbitMQ delivery mechanics but no account behavior. The supplied
 * handler defines the transaction boundary: returning `ack` asserts that its
 * durable work has committed, after which this transport acknowledges safely.
 */
@Injectable()
export class RabbitMqConsumerTransport implements OnApplicationShutdown {
  private readonly logger = new Logger(RabbitMqConsumerTransport.name);
  private connection?: RecoveringChannelModel;
  private consumerChannel?: Channel;
  private publisherChannel?: ConfirmChannel;
  private consumerTag?: string;
  private handler?: RabbitMqMessageHandler;
  private readonly inFlight = new Set<Promise<void>>();
  private started = false;
  private stopping = false;

  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
    @Inject(AMQP_CONNECT) private readonly connectAmqp: AmqpConnect,
  ) {}

  async start(handler: RabbitMqMessageHandler): Promise<void> {
    if (this.started) {
      throw new Error('RabbitMQ consumer transport has already been started');
    }

    this.started = true;
    this.handler = handler;
    this.stopping = false;

    try {
      // amqplib reruns `setup` after every reconnect. Keeping topology and
      // consumer creation there makes recovery equivalent to a clean startup.
      const connection = await this.connectAmqp(
        this.config.getOrThrow('RABBITMQ_URL'),
        {
          recovery: {
            initialDelay: 100,
            maxDelay: 30_000,
            factor: 2,
            jitter: 0.2,
            maxRetries: Number.POSITIVE_INFINITY,
            setup: async (model: ChannelModel) => this.setupConnection(model),
          },
        },
      );
      this.connection = connection;
      this.registerConnectionLogging(connection);
    } catch (error) {
      this.started = false;
      this.handler = undefined;
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.stopping || !this.started) {
      return;
    }

    this.stopping = true;

    // Stop new deliveries first, then allow accepted work and confirmations to
    // finish before closing channels. This avoids abandoning committed work
    // during an ordinary Nest shutdown.
    if (this.consumerChannel && this.consumerTag) {
      await this.consumerChannel.cancel(this.consumerTag).catch((error) => {
        this.logger.warn(
          `Unable to cancel RabbitMQ consumer: ${String(error)}`,
        );
      });
    }

    await Promise.allSettled(this.inFlight);
    await this.publisherChannel?.waitForConfirms().catch((error) => {
      this.logger.warn(
        `Unable to drain RabbitMQ publisher confirmations: ${String(error)}`,
      );
    });
    await this.publisherChannel?.close().catch((error) => {
      this.logger.warn(
        `Unable to close RabbitMQ publisher channel: ${String(error)}`,
      );
    });
    await this.consumerChannel?.close().catch((error) => {
      this.logger.warn(
        `Unable to close RabbitMQ consumer channel: ${String(error)}`,
      );
    });
    await this.connection?.close().catch((error) => {
      this.logger.warn(`Unable to close RabbitMQ connection: ${String(error)}`);
    });

    this.connection = undefined;
    this.consumerChannel = undefined;
    this.publisherChannel = undefined;
    this.consumerTag = undefined;
    this.handler = undefined;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.close();
  }

  private topology(): TopologyConfiguration {
    return {
      domainExchange: this.config.getOrThrow('RABBITMQ_EXCHANGE'),
      mainQueue: this.config.getOrThrow('RABBITMQ_USER_REGISTERED_QUEUE'),
      routingKey: this.config.getOrThrow(
        'RABBITMQ_USER_REGISTERED_ROUTING_KEY',
      ),
      retryExchange: this.config.getOrThrow('RABBITMQ_RETRY_EXCHANGE'),
      retryDelays: this.config.getOrThrow('RABBITMQ_RETRY_DELAYS_MS'),
      deadLetterExchange: this.config.getOrThrow(
        'RABBITMQ_DEAD_LETTER_EXCHANGE',
      ),
      deadLetterQueue: this.config.getOrThrow('RABBITMQ_DEAD_LETTER_QUEUE'),
      prefetch: this.config.getOrThrow('RABBITMQ_PREFETCH'),
    };
  }

  private async setupConnection(model: ChannelModel): Promise<void> {
    if (this.stopping || !this.handler) {
      return;
    }

    const topology = this.topology();
    // Publishing retries/DLQ messages on a confirm channel lets the consumer
    // acknowledge only after RabbitMQ has durably accepted the replacement.
    const publisherChannel = await model.createConfirmChannel();
    const consumerChannel = await model.createChannel();
    this.registerChannelRecovery(model, publisherChannel, 'publisher');
    this.registerChannelRecovery(model, consumerChannel, 'consumer');

    await this.declareTopology(consumerChannel, topology);
    await consumerChannel.prefetch(topology.prefetch);
    const reply = await consumerChannel.consume(
      topology.mainQueue,
      (message) => {
        if (message === null) {
          this.logger.error('RabbitMQ cancelled the consumer');
          void this.recycleConnection(model);
          return;
        }

        const processing = this.processDelivery(
          message,
          consumerChannel,
          publisherChannel,
          topology,
        ).catch((error) => {
          // Connection loss already causes RabbitMQ to requeue unacknowledged
          // deliveries. Keep an acknowledgement failure from becoming an
          // unhandled promise rejection while recovery replaces the channel.
          this.logger.error(
            `RabbitMQ delivery finalization failed: ${String(error)}`,
          );
        });
        this.inFlight.add(processing);
        void processing.finally(() => this.inFlight.delete(processing));
      },
      { noAck: false },
    );

    this.publisherChannel = publisherChannel;
    this.consumerChannel = consumerChannel;
    this.consumerTag = reply.consumerTag;
  }

  private async declareTopology(
    channel: Channel,
    topology: TopologyConfiguration,
  ): Promise<void> {
    await channel.assertExchange(topology.domainExchange, 'topic', {
      durable: true,
    });
    await channel.assertExchange(topology.retryExchange, 'direct', {
      durable: true,
    });
    await channel.assertExchange(topology.deadLetterExchange, 'direct', {
      durable: true,
    });
    await channel.assertQueue(topology.mainQueue, { durable: true });
    await channel.bindQueue(
      topology.mainQueue,
      topology.domainExchange,
      topology.routingKey,
    );

    for (const [index, delay] of topology.retryDelays.entries()) {
      const retryQueue = `${topology.mainQueue}.retry.${index + 1}`;
      // Retry queues are delay buckets: their TTL expiry dead-letters the
      // unchanged message back to the domain exchange for another attempt.
      await channel.assertQueue(retryQueue, {
        durable: true,
        messageTtl: delay,
        deadLetterExchange: topology.domainExchange,
        deadLetterRoutingKey: topology.routingKey,
      });
      await channel.bindQueue(retryQueue, topology.retryExchange, retryQueue);
    }

    await channel.assertQueue(topology.deadLetterQueue, { durable: true });
    await channel.bindQueue(
      topology.deadLetterQueue,
      topology.deadLetterExchange,
      topology.deadLetterQueue,
    );
  }

  private async processDelivery(
    message: ConsumeMessage,
    consumerChannel: Channel,
    publisherChannel: ConfirmChannel,
    topology: TopologyConfiguration,
  ): Promise<void> {
    // Transport-level failures never reach application code. Contract-level
    // failures are returned by the handler through MessageHandlingResult. WIP!!!
    let body: unknown;
    try {
      body = JSON.parse(message.content.toString('utf8')) as unknown;
    } catch {
      await this.deadLetterOrRequeue(
        message,
        consumerChannel,
        publisherChannel,
        topology,
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
        topology,
        {
          category: 'INVALID_RETRY_METADATA',
          reason: 'x-retry-count must be an integer from 0 through 5',
          retryCount: 0,
          eventId,
        },
      );
      return;
    }

    if (message.fields.routingKey !== topology.routingKey) {
      await this.deadLetterOrRequeue(
        message,
        consumerChannel,
        publisherChannel,
        topology,
        {
          category: 'ROUTING_KEY_MISMATCH',
          reason: 'message routing key does not match the consumer contract',
          retryCount,
          eventId,
        },
      );
      return;
    }

    try {
      const result = await this.handler!.handle({
        body,
        rawBody: Buffer.from(message.content),
        routingKey: message.fields.routingKey,
        eventId,
        retryCount,
      });

      if (result.outcome === 'ack') {
        // The handler contract guarantees that all durable application work
        // has committed before it returns this outcome.
        consumerChannel.ack(message);
        return;
      }

      await this.deadLetterOrRequeue(
        message,
        consumerChannel,
        publisherChannel,
        topology,
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
          topology,
          retryCount + 1,
          eventId,
        );
        return;
      }

      await this.deadLetterOrRequeue(
        message,
        consumerChannel,
        publisherChannel,
        topology,
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
    topology: TopologyConfiguration,
    retryCount: number,
    eventId?: string,
  ): Promise<void> {
    const retryQueue = `${topology.mainQueue}.retry.${retryCount}`;
    try {
      // Confirming the replacement before acknowledging the original prevents
      // a transient processing failure from being lost between queues.
      await this.publishConfirmed(
        publisherChannel,
        topology.retryExchange,
        retryQueue,
        message.content,
        this.publishOptions(message, {
          category: 'TRANSIENT_PROCESSING_FAILURE',
          reason: 'transient message processing failure',
          retryCount,
          eventId,
        }),
      );
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
    topology: TopologyConfiguration,
    failure: FailureMetadata,
  ): Promise<void> {
    try {
      await this.publishConfirmed(
        publisherChannel,
        topology.deadLetterExchange,
        topology.deadLetterQueue,
        message.content,
        this.publishOptions(message, failure),
      );
      consumerChannel.ack(message);
      this.logger.warn(
        `Dead-lettered event ${failure.eventId ?? 'unknown'}: ${failure.category}`,
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
    // Preserve correlation metadata, but deliberately omit `expiration`: the
    // retry queue's configured TTL is the sole authority for retry timing.
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
    // Publisher confirms prove broker acceptance; `drain` separately handles
    // client-side socket backpressure when publish() returns false.
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
      if (!this.stopping) {
        this.logger.warn(`RabbitMQ ${name} channel closed unexpectedly`);
        void this.recycleConnection(model);
      }
    });
  }

  private async recycleConnection(model: ChannelModel): Promise<void> {
    if (this.stopping) {
      return;
    }

    // Automatic recovery operates at connection level. Recycling the model
    // turns an isolated channel loss into a full setup/consumer recreation.
    await model.close().catch(() => undefined);
  }
}
