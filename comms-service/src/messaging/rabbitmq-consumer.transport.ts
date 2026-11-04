import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { TextDecoder } from 'node:util';
import { annotateConsumeSpan } from '@foc/observability';
import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import type {
  Channel,
  ConfirmChannel,
  ConsumeMessage,
  Message,
  MessageProperties,
  Options,
} from 'amqplib';
import { RabbitMqConnectionService } from './rabbitmq-connection.service.js';
import type {
  LifecycleMessageHandlingResult,
  LifecycleSubscription,
  PermanentMessageFailure,
} from './rabbitmq-message.types.js';
import {
  COMMS_DEAD_LETTER_EXCHANGE,
  COMMS_DOMAIN_EXCHANGE,
  COMMS_LIFECYCLE_STREAMS,
  COMMS_RETRY_DELAYS_MS,
  COMMS_RETRY_EXCHANGE,
  COMMS_RETRY_RETURN_EXCHANGE,
} from './rabbitmq-topology.js';
import { commsMetrics } from '../observability/comms-metrics.js';

const CONSUMER_PREFETCH = 10;
const MAX_RETRY_COUNT = COMMS_RETRY_DELAYS_MS.length;
const MAX_FAILURE_REASON_LENGTH = 512;
const MAX_AMQP_SHORT_STRING_BYTES = 255;
const PUBLICATION_ID_HEADER = 'x-comms-publication-id';
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });
const SAFE_TRACE_HEADERS = new Set(['traceparent', 'tracestate']);
const TRANSPORT_HEADERS = new Set([
  'x-retry-count',
  'x-event-id',
  'x-failure-category',
  'x-failure-reason',
  'x-failure-timestamp',
  PUBLICATION_ID_HEADER,
]);

class UnroutablePublicationError extends Error {
  constructor(exchange: string, routingKey: string) {
    super(`RabbitMQ publication was unroutable on ${exchange}:${routingKey}`);
    this.name = 'UnroutablePublicationError';
  }
}

type TransportFailureCategory =
  | 'INVALID_CONTENT_METADATA'
  | 'MALFORMED_JSON'
  | 'ROUTING_KEY_MISMATCH'
  | 'INVALID_RETRY_METADATA'
  | 'TRANSIENT_PROCESSING_FAILURE'
  | 'PROCESSING_RETRIES_EXHAUSTED';

interface ConsumerState {
  channel: Channel;
  consumerTag: string;
  replacing: boolean;
}

interface FailureMetadata {
  category: TransportFailureCategory | PermanentMessageFailure;
  reason: string;
  retryCount: number;
  eventId?: string;
}

interface PendingPublication {
  channel: ConfirmChannel;
  resolveRouting: () => void;
  rejectRouting: (error: Error) => void;
}

function safeAmqpShortString(value: unknown): string | undefined {
  return typeof value === 'string' &&
    Buffer.byteLength(value, 'utf8') <= MAX_AMQP_SHORT_STRING_BYTES
    ? value
    : undefined;
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
    return safeAmqpShortString(body.eventId);
  }
  return safeAmqpShortString(properties.messageId);
}

function retryCountFrom(message: ConsumeMessage): number | undefined {
  const value = message.properties.headers?.['x-retry-count'];
  if (value === undefined) return 0;
  return Number.isInteger(value) && value >= 0 && value <= MAX_RETRY_COUNT
    ? (value as number)
    : undefined;
}

function sanitizeFailureReason(reason: string): string {
  const sanitized = reason.replace(/[\r\n\t]+/g, ' ').trim();
  return (sanitized || 'message processing failed').slice(
    0,
    MAX_FAILURE_REASON_LENGTH,
  );
}

/**
 * Consumes only infrastructure-owned lifecycle queues. It deliberately never
 * declares a queue, exchange, or binding; Package 1's provisioner owns the
 * service topology and root RabbitMQ definitions own the primary queues.
 */
@Injectable()
export class RabbitMqConsumerTransport implements OnApplicationShutdown {
  private readonly logger = new Logger(RabbitMqConsumerTransport.name);
  private readonly subscriptions = new Map<string, LifecycleSubscription>();
  private readonly consumers = new Map<string, ConsumerState>();
  private readonly inFlight = new Set<Promise<void>>();
  private readonly pendingPublications = new Map<string, PendingPublication>();
  private publisherChannel?: ConfirmChannel;
  private publisherPromise?: Promise<ConfirmChannel>;
  private mutation: Promise<void> = Promise.resolve();
  private unregisterBeforeClose?: () => void;
  private stopping = false;
  private closed = false;

  constructor(private readonly connection: RabbitMqConnectionService) {
    this.unregisterBeforeClose = this.connection.registerBeforeClose(() =>
      this.close(),
    );
  }

  async subscribeAll(
    subscriptions: readonly LifecycleSubscription[],
  ): Promise<void> {
    await Promise.all(
      subscriptions.map((subscription) => this.subscribe(subscription)),
    );
  }

  async subscribe(subscription: LifecycleSubscription): Promise<void> {
    if (this.stopping || this.closed) {
      throw new Error('RabbitMQ consumer transport is shutting down');
    }
    this.assertKnownStream(subscription);
    if (this.subscriptions.has(subscription.queue)) {
      throw new Error(
        `RabbitMQ queue ${subscription.queue} is already subscribed`,
      );
    }

    // Reserve synchronously so concurrent registrations cannot duplicate a
    // consumer. Installation is serialized because shutdown/replacement also
    // mutate the same channel registry.
    this.subscriptions.set(
      subscription.queue,
      Object.freeze({ ...subscription }),
    );
    try {
      await this.getPublisherChannel();
      await this.serializeMutation(() =>
        this.installSubscription(subscription),
      );
    } catch (error) {
      if (!this.consumers.has(subscription.queue)) {
        this.subscriptions.delete(subscription.queue);
      }
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.stopping = true;
    this.unregisterBeforeClose?.();
    this.unregisterBeforeClose = undefined;

    await this.mutation;
    const states = [...this.consumers.values()];
    await Promise.allSettled(
      states.map(({ channel, consumerTag }) => channel.cancel(consumerTag)),
    );
    await Promise.allSettled(this.inFlight);
    await this.publisherChannel?.waitForConfirms().catch((error) => {
      this.logger.warn(
        `Unable to drain RabbitMQ publisher confirmations: ${String(error)}`,
      );
    });
    await Promise.allSettled(states.map(({ channel }) => channel.close()));
    await this.publisherChannel?.close().catch((error) => {
      this.logger.warn(
        `Unable to close RabbitMQ publisher channel: ${String(error)}`,
      );
    });
    this.consumers.clear();
    this.publisherChannel = undefined;
    this.publisherPromise = undefined;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.close();
  }

  private assertKnownStream(subscription: LifecycleSubscription): void {
    const stream = COMMS_LIFECYCLE_STREAMS.find(
      ({ queue }) => queue === subscription.queue,
    );
    if (!stream || stream.routingKey !== subscription.routingKey) {
      throw new Error('RabbitMQ subscription is not a known lifecycle stream');
    }
  }

  private serializeMutation<T>(work: () => Promise<T>): Promise<T> {
    const result = this.mutation.then(work, work);
    this.mutation = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async getPublisherChannel(): Promise<ConfirmChannel> {
    if (this.stopping) {
      throw new Error('RabbitMQ consumer transport is shutting down');
    }
    if (!this.publisherPromise) {
      this.publisherPromise = this.connection
        .createConfirmChannel()
        .then((channel) => {
          this.publisherChannel = channel;
          channel.on('error', (error) =>
            this.handlePublisherChannelError(channel, error),
          );
          channel.on('return', (message) =>
            this.handleReturnedPublication(message),
          );
          channel.on('close', () => {
            this.rejectPendingPublications(
              channel,
              new Error('RabbitMQ publisher channel closed'),
            );
            if (this.publisherChannel === channel) {
              this.publisherChannel = undefined;
              this.publisherPromise = undefined;
            }
          });
          return channel;
        })
        .catch((error) => {
          this.publisherPromise = undefined;
          throw error;
        });
    }
    return this.publisherPromise;
  }

  private async installSubscription(
    subscription: LifecycleSubscription,
  ): Promise<void> {
    if (this.stopping) {
      throw new Error('RabbitMQ consumer transport is shutting down');
    }
    if (this.consumers.has(subscription.queue)) return;

    const channel = await this.connection.createChannel();
    try {
      // Passive inspection proves the infrastructure-owned queue exists. This
      // service never asserts it or touches its foc.events binding.
      await channel.checkQueue(subscription.queue);
      await channel.prefetch(CONSUMER_PREFETCH);
      const reply = await channel.consume(
        subscription.queue,
        (message) => this.receive(message, channel, subscription),
        { noAck: false },
      );
      const state: ConsumerState = {
        channel,
        consumerTag: reply.consumerTag,
        replacing: false,
      };
      this.consumers.set(subscription.queue, state);
      channel.on('error', (error) =>
        this.logger.error(
          `RabbitMQ consumer ${subscription.queue} error: ${error.message}`,
        ),
      );
      channel.on('close', () => {
        const current = this.consumers.get(subscription.queue);
        if (
          !this.stopping &&
          current?.channel === channel &&
          !current.replacing
        ) {
          this.logger.warn(
            `RabbitMQ consumer ${subscription.queue} closed unexpectedly`,
          );
          void this.replaceConsumer(subscription, channel);
        }
      });
    } catch (error) {
      await channel.close().catch(() => undefined);
      throw error;
    }
  }

  private receive(
    message: ConsumeMessage | null,
    channel: Channel,
    subscription: LifecycleSubscription,
  ): void {
    if (message === null) {
      this.logger.error(
        `RabbitMQ cancelled consumer for ${subscription.queue}`,
      );
      void this.replaceConsumer(subscription, channel);
      return;
    }

    const processing = this.processDelivery(
      message,
      channel,
      subscription,
    ).catch((error) => {
      this.logger.error(
        `RabbitMQ delivery finalization failed for ${subscription.queue}: ${String(error)}`,
      );
    });
    this.inFlight.add(processing);
    void processing.finally(() => this.inFlight.delete(processing));
  }

  private async processDelivery(
    message: ConsumeMessage,
    consumerChannel: Channel,
    subscription: LifecycleSubscription,
  ): Promise<void> {
    const retryCount = retryCountFrom(message);
    if (retryCount === undefined) {
      await this.deadLetter(message, consumerChannel, subscription, {
        category: 'INVALID_RETRY_METADATA',
        reason: `x-retry-count must be an integer from 0 through ${MAX_RETRY_COUNT}`,
        retryCount: 0,
        eventId: safeAmqpShortString(message.properties.messageId),
      });
      return;
    }

    const validInitialRoute =
      retryCount === 0 &&
      message.fields.exchange === COMMS_DOMAIN_EXCHANGE &&
      message.fields.routingKey === subscription.routingKey;
    const validRetryRoute =
      retryCount > 0 &&
      message.fields.exchange === COMMS_RETRY_RETURN_EXCHANGE &&
      message.fields.routingKey === subscription.queue;
    if (!validInitialRoute && !validRetryRoute) {
      await this.deadLetter(message, consumerChannel, subscription, {
        category: 'ROUTING_KEY_MISMATCH',
        reason: 'message route does not match the lifecycle stream',
        retryCount,
        eventId: safeAmqpShortString(message.properties.messageId),
      });
      return;
    }

    const contentType = message.properties.contentType;
    const contentEncoding = message.properties.contentEncoding?.toLowerCase();
    if (contentType !== undefined && contentType !== 'application/json') {
      await this.deadLetter(message, consumerChannel, subscription, {
        category: 'INVALID_CONTENT_METADATA',
        reason: 'content-type must be application/json when present',
        retryCount,
        eventId: safeAmqpShortString(message.properties.messageId),
      });
      return;
    }
    if (
      contentEncoding !== undefined &&
      contentEncoding !== 'utf-8' &&
      contentEncoding !== 'utf8'
    ) {
      await this.deadLetter(message, consumerChannel, subscription, {
        category: 'INVALID_CONTENT_METADATA',
        reason: 'content-encoding must be UTF-8 when present',
        retryCount,
        eventId: safeAmqpShortString(message.properties.messageId),
      });
      return;
    }

    let body: unknown;
    try {
      body = JSON.parse(UTF8_DECODER.decode(message.content)) as unknown;
    } catch {
      await this.deadLetter(message, consumerChannel, subscription, {
        category: 'MALFORMED_JSON',
        reason: 'message body is not valid UTF-8 JSON',
        retryCount,
        eventId: safeAmqpShortString(message.properties.messageId),
      });
      return;
    }

    const eventId = extractEventId(body, message.properties);
    annotateConsumeSpan({
      messageId: eventId,
      routingKey: subscription.routingKey,
      retryCount,
    });

    let result: LifecycleMessageHandlingResult;
    const handlerStarted = process.hrtime.bigint();
    try {
      result = await subscription.handler.handle({
        body,
        rawBody: Buffer.from(message.content),
        routingKey: subscription.routingKey,
        eventId,
        retryCount,
      });
    } catch (error) {
      this.logger.warn(
        `Transient RabbitMQ handler failure for event ${eventId ?? 'unknown'} on attempt ${retryCount + 1}: ${error instanceof Error ? error.name : 'Error'}`,
      );
      result = {
        outcome: 'transient-failure',
        reason: 'lifecycle handler threw a transient error',
      };
    }

    commsMetrics.observeLifecycleHandler(
      subscription.routingKey,
      result.outcome,
      Number(process.hrtime.bigint() - handlerStarted) / 1_000_000_000,
    );

    if (result.outcome === 'processed' || result.outcome === 'duplicate') {
      if (await this.ackOrReplace(message, consumerChannel, subscription)) {
        commsMetrics.lifecycleDelivery(
          subscription.routingKey,
          result.outcome === 'processed' ? 'successful' : 'duplicate',
        );
      }
      return;
    }
    if (result.outcome === 'permanent-failure') {
      await this.deadLetter(message, consumerChannel, subscription, {
        category: result.category,
        reason: result.reason,
        retryCount,
        eventId: result.eventId ?? eventId,
      });
      return;
    }

    if (retryCount < MAX_RETRY_COUNT) {
      await this.retry(
        message,
        consumerChannel,
        subscription,
        retryCount + 1,
        eventId,
        result.reason,
      );
      return;
    }
    await this.deadLetter(message, consumerChannel, subscription, {
      category: 'PROCESSING_RETRIES_EXHAUSTED',
      reason: 'message processing failed after five retries',
      retryCount,
      eventId,
    });
  }

  private async ackOrReplace(
    message: ConsumeMessage,
    channel: Channel,
    subscription: LifecycleSubscription,
  ): Promise<boolean> {
    try {
      channel.ack(message);
      return true;
    } catch (error) {
      this.logger.error(
        `Unable to acknowledge event from ${subscription.queue}: ${String(error)}`,
      );
      await this.replaceConsumer(subscription, channel);
      return false;
    }
  }

  private async retry(
    message: ConsumeMessage,
    consumerChannel: Channel,
    subscription: LifecycleSubscription,
    retryCount: number,
    eventId: string | undefined,
    reason: string,
  ): Promise<void> {
    try {
      await this.publishConfirmed(
        await this.getPublisherChannel(),
        COMMS_RETRY_EXCHANGE,
        `${subscription.queue}.retry.${retryCount}`,
        message.content,
        this.publishOptions(message, {
          category: 'TRANSIENT_PROCESSING_FAILURE',
          reason,
          retryCount,
          eventId,
        }),
      );
      consumerChannel.ack(message);
      commsMetrics.lifecycleDelivery(subscription.routingKey, 'retried');
    } catch (error) {
      this.logger.error(
        `Unable to safely publish retry for event ${eventId ?? 'unknown'}: ${String(error)}`,
      );
      await this.replaceConsumer(subscription, consumerChannel);
    }
  }

  private async deadLetter(
    message: ConsumeMessage,
    consumerChannel: Channel,
    subscription: LifecycleSubscription,
    failure: FailureMetadata,
  ): Promise<void> {
    try {
      await this.publishConfirmed(
        await this.getPublisherChannel(),
        COMMS_DEAD_LETTER_EXCHANGE,
        `${subscription.queue}.dlq`,
        message.content,
        this.publishOptions(message, failure),
      );
      consumerChannel.ack(message);
      commsMetrics.lifecycleDelivery(
        subscription.routingKey,
        failure.category === 'IDENTITY_CONFLICT'
          ? 'conflicting'
          : 'dead_lettered',
      );
      this.logger.warn(
        `Dead-lettered event ${failure.eventId ?? 'unknown'} from ${subscription.queue}: ${failure.category}`,
      );
    } catch (error) {
      this.logger.error(
        `Unable to safely publish dead letter for event ${failure.eventId ?? 'unknown'}: ${String(error)}`,
      );
      await this.replaceConsumer(subscription, consumerChannel);
    }
  }

  private publishOptions(
    message: ConsumeMessage,
    failure: FailureMetadata,
  ): Options.Publish {
    const properties = message.properties;
    const safeHeaders = Object.fromEntries(
      Object.entries(properties.headers ?? {}).filter(
        ([name, value]) =>
          SAFE_TRACE_HEADERS.has(name.toLowerCase()) &&
          !TRANSPORT_HEADERS.has(name.toLowerCase()) &&
          safeAmqpShortString(value) !== undefined,
      ),
    );
    const headers: Record<string, unknown> = {
      ...safeHeaders,
      'x-retry-count': failure.retryCount,
      'x-failure-category': failure.category,
      'x-failure-reason': sanitizeFailureReason(failure.reason),
      'x-failure-timestamp': new Date().toISOString(),
    };
    if (failure.eventId) headers['x-event-id'] = failure.eventId;

    return {
      persistent: true,
      contentType: 'application/json',
      contentEncoding: 'utf-8',
      correlationId: safeAmqpShortString(properties.correlationId),
      messageId:
        safeAmqpShortString(failure.eventId) ??
        safeAmqpShortString(properties.messageId),
      timestamp:
        typeof properties.timestamp === 'number'
          ? properties.timestamp
          : undefined,
      type: safeAmqpShortString(properties.type),
      appId: safeAmqpShortString(properties.appId),
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
    const publicationId = randomUUID();
    let resolveConfirmation!: () => void;
    let rejectConfirmation!: (error: unknown) => void;
    const confirmation = new Promise<void>((resolve, reject) => {
      resolveConfirmation = resolve;
      rejectConfirmation = reject;
    });
    let resolveRouting!: () => void;
    let rejectRouting!: (error: Error) => void;
    const routed = new Promise<void>((resolve, reject) => {
      resolveRouting = resolve;
      rejectRouting = reject;
    });
    this.pendingPublications.set(publicationId, {
      channel,
      resolveRouting,
      rejectRouting,
    });

    let writable = true;
    try {
      writable = channel.publish(
        exchange,
        routingKey,
        content,
        {
          ...options,
          mandatory: true,
          headers: {
            ...options.headers,
            [PUBLICATION_ID_HEADER]: publicationId,
          },
        },
        (error) => {
          if (error) {
            rejectConfirmation(error);
            rejectRouting(error);
            return;
          }
          resolveConfirmation();
          resolveRouting();
        },
      );
    } catch (error) {
      rejectConfirmation(error);
      rejectRouting(error instanceof Error ? error : new Error(String(error)));
    }
    const drained = writable ? Promise.resolve() : once(channel, 'drain');
    try {
      await Promise.all([confirmation, routed, drained]);
    } finally {
      this.pendingPublications.delete(publicationId);
    }
  }

  private handleReturnedPublication(message: Message): void {
    const publicationId = safeAmqpShortString(
      message.properties.headers?.[PUBLICATION_ID_HEADER],
    );
    if (!publicationId) {
      this.logger.error(
        'RabbitMQ returned a replacement publication without a valid publication ID',
      );
      return;
    }
    const pending = this.pendingPublications.get(publicationId);
    if (!pending) {
      this.logger.error('RabbitMQ returned an unknown replacement publication');
      return;
    }
    pending.rejectRouting(
      new UnroutablePublicationError(
        message.fields.exchange,
        message.fields.routingKey,
      ),
    );
  }

  private handlePublisherChannelError(
    channel: ConfirmChannel,
    error: Error,
  ): void {
    this.logger.error(`RabbitMQ publisher channel error: ${error.message}`);
    this.rejectPendingPublications(channel, error);
  }

  private rejectPendingPublications(
    channel: ConfirmChannel,
    error: Error,
  ): void {
    for (const pending of this.pendingPublications.values()) {
      if (pending.channel === channel) pending.rejectRouting(error);
    }
  }

  private async replaceConsumer(
    subscription: LifecycleSubscription,
    failedChannel: Channel,
  ): Promise<void> {
    await this.serializeMutation(async () => {
      const current = this.consumers.get(subscription.queue);
      if (
        this.stopping ||
        !current ||
        current.channel !== failedChannel ||
        current.replacing
      ) {
        return;
      }
      current.replacing = true;
      this.consumers.delete(subscription.queue);
      // Closing returns every unacknowledged delivery to RabbitMQ. A fresh
      // channel then restores this stream without disturbing its siblings.
      await failedChannel.close().catch(() => undefined);
      if (!this.stopping) await this.installSubscription(subscription);
    });
  }
}
