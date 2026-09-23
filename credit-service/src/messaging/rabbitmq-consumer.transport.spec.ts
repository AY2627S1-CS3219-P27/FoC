import { EventEmitter } from 'node:events';
import type { ConfigService } from '@nestjs/config';
import type {
  ChannelModel,
  ConsumeMessage,
  Options,
  RecoveryOptions,
} from 'amqplib';
import type { EnvironmentVariables } from '../config/environment.js';
import type { AmqpConnect } from './amqp-connection.provider.js';
import { RabbitMqConsumerTransport } from './rabbitmq-consumer.transport.js';
import type { RabbitMqMessageHandler } from './rabbitmq-message.types.js';

const configuration: EnvironmentVariables = {
  NODE_ENV: 'test',
  PORT: 3000,
  LOG_LEVEL: 'error',
  DB_HOST: 'credit-db',
  DB_PORT: 5432,
  DB_USERNAME: 'credit_service',
  DB_DATABASE: 'credit_service',
  DB_PASSWORD_FILE: '/run/secrets/credit_db_password',
  INITIAL_CREDIT_BALANCE: 100,
  RABBITMQ_URL: 'amqp://credit_service:test@credit-rabbitmq:5672',
  RABBITMQ_EXCHANGE: 'foc.events',
  RABBITMQ_USER_REGISTERED_QUEUE: 'credit-service.user-registered.v1',
  RABBITMQ_USER_REGISTERED_ROUTING_KEY: 'user.registered.v1',
  RABBITMQ_CREDIT_ACCOUNT_INITIALISED_ROUTING_KEY:
    'credit.account-initialised.v1',
  RABBITMQ_RETRY_EXCHANGE: 'foc.credit.retry',
  RABBITMQ_DEAD_LETTER_EXCHANGE: 'foc.credit.dlx',
  RABBITMQ_DEAD_LETTER_QUEUE: 'credit-service.user-registered.v1.dlq',
  RABBITMQ_PREFETCH: 10,
  RABBITMQ_RETRY_DELAYS_MS: [1_000, 2_000, 4_000, 8_000, 16_000],
  OUTBOX_POLL_INTERVAL_MS: 1_000,
  OUTBOX_BATCH_SIZE: 100,
  OUTBOX_CLAIM_LEASE_MS: 30_000,
  OUTBOX_UNPUBLISHED_WARNING_MS: 60_000,
};

interface PublishedMessage {
  exchange: string;
  routingKey: string;
  content: Buffer;
  options: Options.Publish;
}

class FakeChannel extends EventEmitter {
  readonly assertedExchanges: unknown[][] = [];
  readonly assertedQueues: unknown[][] = [];
  readonly bindings: unknown[][] = [];
  readonly published: PublishedMessage[] = [];
  readonly acknowledged: ConsumeMessage[] = [];
  readonly rejected: Array<{
    message: ConsumeMessage;
    allUpTo?: boolean;
    requeue?: boolean;
  }> = [];
  readonly cancelled: string[] = [];
  prefetchCount?: number;
  consumeOptions?: Options.Consume;
  onMessage?: (message: ConsumeMessage | null) => void;
  automaticConfirmation = true;
  confirmationError?: Error;
  writable = true;
  closed = false;
  private readonly pendingConfirmations: Array<(error?: Error) => void> = [];

  async assertExchange(...args: unknown[]): Promise<{ exchange: string }> {
    this.assertedExchanges.push(args);
    return { exchange: String(args[0]) };
  }

  async assertQueue(...args: unknown[]): Promise<{
    queue: string;
    messageCount: number;
    consumerCount: number;
  }> {
    this.assertedQueues.push(args);
    return { queue: String(args[0]), messageCount: 0, consumerCount: 0 };
  }

  async bindQueue(...args: unknown[]): Promise<Record<string, never>> {
    this.bindings.push(args);
    return {};
  }

  async prefetch(count: number): Promise<Record<string, never>> {
    this.prefetchCount = count;
    return {};
  }

  async consume(
    _queue: string,
    onMessage: (message: ConsumeMessage | null) => void,
    options?: Options.Consume,
  ): Promise<{ consumerTag: string }> {
    this.onMessage = onMessage;
    this.consumeOptions = options;
    return { consumerTag: 'consumer-tag' };
  }

  publish(
    exchange: string,
    routingKey: string,
    content: Buffer,
    options: Options.Publish,
    confirmation?: (error: Error | null) => void,
  ): boolean {
    this.published.push({
      exchange,
      routingKey,
      content: Buffer.from(content),
      options,
    });

    if (confirmation) {
      if (this.automaticConfirmation) {
        queueMicrotask(() => confirmation(this.confirmationError ?? null));
      } else {
        this.pendingConfirmations.push((error) => confirmation(error ?? null));
      }
    }
    return this.writable;
  }

  confirmNext(error?: Error): void {
    this.pendingConfirmations.shift()?.(error);
  }

  ack(message: ConsumeMessage): void {
    this.acknowledged.push(message);
  }

  nack(message: ConsumeMessage, allUpTo?: boolean, requeue?: boolean): void {
    this.rejected.push({ message, allUpTo, requeue });
  }

  async cancel(consumerTag: string): Promise<Record<string, never>> {
    this.cancelled.push(consumerTag);
    return {};
  }

  async waitForConfirms(): Promise<void> {}

  async close(): Promise<void> {
    this.closed = true;
  }
}

class FakeModel extends EventEmitter {
  readonly consumer = new FakeChannel();
  readonly publisher = new FakeChannel();
  closed = false;

  async createChannel(): Promise<FakeChannel> {
    return this.consumer;
  }

  async createConfirmChannel(): Promise<FakeChannel> {
    return this.publisher;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

function message(
  body: Buffer = Buffer.from(
    JSON.stringify({
      eventId: '19860606-e57b-4e8d-baa9-7f5b11293f41',
      eventType: 'UserRegistered',
    }),
  ),
  overrides: {
    routingKey?: string;
    headers?: Record<string, unknown>;
  } = {},
): ConsumeMessage {
  return {
    content: body,
    fields: {
      consumerTag: 'consumer-tag',
      deliveryTag: 1,
      redelivered: false,
      exchange: 'foc.events',
      routingKey: overrides.routingKey ?? 'user.registered.v1',
    },
    properties: {
      contentType: 'application/json',
      contentEncoding: undefined,
      headers: overrides.headers ?? {},
      deliveryMode: 2,
      priority: undefined,
      correlationId: 'correlation-id',
      replyTo: undefined,
      expiration: '999999',
      messageId: undefined,
      timestamp: 1_795_000_000,
      type: 'UserRegistered',
      userId: undefined,
      appId: 'user-service',
      clusterId: undefined,
    },
  };
}

function createHarness(
  handler: RabbitMqMessageHandler = {
    handle: vi.fn().mockResolvedValue({ outcome: 'ack' }),
  },
) {
  const config = {
    getOrThrow: vi.fn((key: keyof EnvironmentVariables) => configuration[key]),
  } as unknown as ConfigService<EnvironmentVariables, true>;
  const model = new FakeModel();
  let recoverySetup: RecoveryOptions['setup'];
  const connect = vi.fn(async (_url, options) => {
    const recovery = options.recovery as RecoveryOptions;
    recoverySetup = recovery.setup;
    await (recovery.setup as (model: ChannelModel) => Promise<void>)(
      model as unknown as ChannelModel,
    );
    return model;
  }) as unknown as AmqpConnect;
  const transport = new RabbitMqConsumerTransport(config, connect);

  return {
    connect,
    handler,
    model,
    transport,
    getRecoverySetup: () => recoverySetup,
  };
}

async function deliver(
  model: FakeModel,
  delivery: ConsumeMessage,
): Promise<void> {
  model.consumer.onMessage?.(delivery);
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('RabbitMqConsumerTransport', () => {
  it('declares the durable topology and starts a manual-ack consumer', async () => {
    const { connect, model, transport } = createHarness();

    await transport.start({
      handle: vi.fn().mockResolvedValue({ outcome: 'ack' }),
    });

    expect(connect).toHaveBeenCalledWith(
      configuration.RABBITMQ_URL,
      expect.objectContaining({ recovery: expect.any(Object) }),
    );
    expect(model.consumer.assertedExchanges).toEqual([
      ['foc.events', 'topic', { durable: true }],
      ['foc.credit.retry', 'direct', { durable: true }],
      ['foc.credit.dlx', 'direct', { durable: true }],
    ]);
    expect(model.consumer.assertedQueues).toEqual([
      ['credit-service.user-registered.v1', { durable: true }],
      ...configuration.RABBITMQ_RETRY_DELAYS_MS.map((delay, index) => [
        `credit-service.user-registered.v1.retry.${index + 1}`,
        {
          durable: true,
          messageTtl: delay,
          deadLetterExchange: 'foc.events',
          deadLetterRoutingKey: 'user.registered.v1',
        },
      ]),
      ['credit-service.user-registered.v1.dlq', { durable: true }],
    ]);
    expect(model.consumer.bindings).toEqual([
      ['credit-service.user-registered.v1', 'foc.events', 'user.registered.v1'],
      ...configuration.RABBITMQ_RETRY_DELAYS_MS.map((_, index) => [
        `credit-service.user-registered.v1.retry.${index + 1}`,
        'foc.credit.retry',
        `credit-service.user-registered.v1.retry.${index + 1}`,
      ]),
      [
        'credit-service.user-registered.v1.dlq',
        'foc.credit.dlx',
        'credit-service.user-registered.v1.dlq',
      ],
    ]);
    expect(model.consumer.prefetchCount).toBe(10);
    expect(model.consumer.consumeOptions).toEqual({ noAck: false });
  });

  it('rejects a repeated start', async () => {
    const { handler, transport } = createHarness();
    await transport.start(handler);

    await expect(transport.start(handler)).rejects.toThrow(
      'already been started',
    );
  });

  it('passes decoded input to the handler and acknowledges success', async () => {
    const handler = {
      handle: vi.fn().mockResolvedValue({ outcome: 'ack' }),
    } satisfies RabbitMqMessageHandler;
    const { model, transport } = createHarness(handler);
    await transport.start(handler);
    const delivery = message();

    await deliver(model, delivery);

    expect(handler.handle).toHaveBeenCalledWith({
      body: {
        eventId: '19860606-e57b-4e8d-baa9-7f5b11293f41',
        eventType: 'UserRegistered',
      },
      rawBody: delivery.content,
      routingKey: 'user.registered.v1',
      eventId: '19860606-e57b-4e8d-baa9-7f5b11293f41',
      retryCount: 0,
    });
    expect(model.consumer.acknowledged).toEqual([delivery]);
  });

  it.each([
    {
      name: 'malformed JSON',
      delivery: message(Buffer.from('{invalid')),
      category: 'MALFORMED_JSON',
    },
    {
      name: 'a routing-key mismatch',
      delivery: message(undefined, { routingKey: 'user.deleted.v1' }),
      category: 'ROUTING_KEY_MISMATCH',
    },
    {
      name: 'invalid retry metadata',
      delivery: message(undefined, { headers: { 'x-retry-count': 'one' } }),
      category: 'INVALID_RETRY_METADATA',
    },
  ])(
    'dead-letters $name without calling the handler',
    async ({ delivery, category }) => {
      const handler = {
        handle: vi.fn().mockResolvedValue({ outcome: 'ack' }),
      } satisfies RabbitMqMessageHandler;
      const { model, transport } = createHarness(handler);
      await transport.start(handler);

      await deliver(model, delivery);

      expect(handler.handle).not.toHaveBeenCalled();
      expect(model.publisher.published[0]).toMatchObject({
        exchange: 'foc.credit.dlx',
        routingKey: 'credit-service.user-registered.v1.dlq',
        options: {
          persistent: true,
          headers: { 'x-failure-category': category },
        },
      });
      expect(model.consumer.acknowledged).toEqual([delivery]);
    },
  );

  it('publishes transient failures to the next retry queue', async () => {
    const handler = {
      handle: vi.fn().mockRejectedValue(new Error('sensitive failure')),
    } satisfies RabbitMqMessageHandler;
    const { model, transport } = createHarness(handler);
    await transport.start(handler);
    const delivery = message(undefined, {
      headers: {
        trace: 'preserved',
        'x-event-id': 'spoofed',
        'x-failure-category': 'spoofed',
      },
    });

    await deliver(model, delivery);

    expect(model.publisher.published[0]).toMatchObject({
      exchange: 'foc.credit.retry',
      routingKey: 'credit-service.user-registered.v1.retry.1',
      content: delivery.content,
      options: {
        persistent: true,
        correlationId: 'correlation-id',
        headers: {
          trace: 'preserved',
          'x-retry-count': 1,
          'x-event-id': '19860606-e57b-4e8d-baa9-7f5b11293f41',
          'x-failure-category': 'TRANSIENT_PROCESSING_FAILURE',
          'x-failure-reason': 'transient message processing failure',
        },
      },
    });
    expect(JSON.stringify(model.publisher.published[0])).not.toContain(
      'sensitive failure',
    );
    expect(model.publisher.published[0].options).not.toHaveProperty(
      'expiration',
    );
    expect(model.consumer.acknowledged).toEqual([delivery]);
  });

  it('dead-letters the sixth failed processing attempt', async () => {
    const handler = {
      handle: vi.fn().mockRejectedValue(new Error('still unavailable')),
    } satisfies RabbitMqMessageHandler;
    const { model, transport } = createHarness(handler);
    await transport.start(handler);
    const delivery = message(undefined, { headers: { 'x-retry-count': 5 } });

    await deliver(model, delivery);

    expect(model.publisher.published[0]).toMatchObject({
      exchange: 'foc.credit.dlx',
      options: {
        headers: {
          'x-retry-count': 5,
          'x-failure-category': 'PROCESSING_RETRIES_EXHAUSTED',
        },
      },
    });
    expect(model.consumer.acknowledged).toEqual([delivery]);
  });

  it('dead-letters explicit permanent failures with a sanitized reason', async () => {
    const handler = {
      handle: vi.fn().mockResolvedValue({
        outcome: 'dead-letter',
        category: 'INVALID_PAYLOAD',
        reason: ` invalid\npayload ${'x'.repeat(600)}`,
      }),
    } satisfies RabbitMqMessageHandler;
    const { model, transport } = createHarness(handler);
    await transport.start(handler);
    await deliver(model, message());

    const headers = model.publisher.published[0].options.headers;
    expect(headers['x-failure-category']).toBe('INVALID_PAYLOAD');
    expect(headers['x-failure-reason']).not.toContain('\n');
    expect(headers['x-failure-reason']).toHaveLength(512);
  });

  it('waits for publisher confirmation before acknowledging', async () => {
    const handler = {
      handle: vi.fn().mockRejectedValue(new Error('temporary')),
    } satisfies RabbitMqMessageHandler;
    const { model, transport } = createHarness(handler);
    model.publisher.automaticConfirmation = false;
    await transport.start(handler);
    const delivery = message();

    model.consumer.onMessage?.(delivery);
    await vi.waitFor(() => expect(model.publisher.published).toHaveLength(1));
    expect(model.consumer.acknowledged).toHaveLength(0);

    model.publisher.confirmNext();
    await vi.waitFor(() =>
      expect(model.consumer.acknowledged).toEqual([delivery]),
    );
  });

  it('requeues the original delivery when publication is not confirmed', async () => {
    const handler = {
      handle: vi.fn().mockRejectedValue(new Error('temporary')),
    } satisfies RabbitMqMessageHandler;
    const { model, transport } = createHarness(handler);
    model.publisher.confirmationError = new Error('broker nack');
    await transport.start(handler);
    const delivery = message();

    await deliver(model, delivery);

    expect(model.consumer.acknowledged).toHaveLength(0);
    expect(model.consumer.rejected).toEqual([
      { message: delivery, allUpTo: false, requeue: true },
    ]);
  });

  it('redeclares topology through the recovery setup callback', async () => {
    const { getRecoverySetup, handler, model, transport } = createHarness();
    await transport.start(handler);
    const recoveredModel = new FakeModel();

    await (getRecoverySetup() as (model: ChannelModel) => Promise<void>)(
      recoveredModel as unknown as ChannelModel,
    );

    expect(recoveredModel.consumer.assertedQueues).toEqual(
      model.consumer.assertedQueues,
    );
    expect(recoveredModel.consumer.onMessage).toEqual(expect.any(Function));
  });

  it('cancels consumption and drains in-flight work before closing', async () => {
    let complete!: () => void;
    const pending = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const handler = {
      handle: vi.fn(async () => {
        await pending;
        return { outcome: 'ack' as const };
      }),
    } satisfies RabbitMqMessageHandler;
    const { model, transport } = createHarness(handler);
    await transport.start(handler);
    model.consumer.onMessage?.(message());
    await vi.waitFor(() => expect(handler.handle).toHaveBeenCalled());

    let closed = false;
    const closing = transport.close().then(() => {
      closed = true;
    });
    await vi.waitFor(() =>
      expect(model.consumer.cancelled).toEqual(['consumer-tag']),
    );
    expect(closed).toBe(false);

    complete();
    await closing;
    expect(model.consumer.closed).toBe(true);
    expect(model.publisher.closed).toBe(true);
    expect(model.closed).toBe(true);
    await expect(transport.close()).resolves.toBeUndefined();
  });
});
