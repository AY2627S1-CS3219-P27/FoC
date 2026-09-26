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
import type {
  RabbitMqMessageHandler,
  Subscription,
} from './rabbitmq-message.types.js';

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
  RABBITMQ_USER: 'credit-service',
  RABBITMQ_HOST: 'rabbitmq',
  RABBITMQ_PORT: 5672,
  RABBITMQ_VHOST: '/foc',
  RABBITMQ_PASSWORD_FILE: '/run/secrets/rabbitmq_password_credit_service',
  RABBITMQ_EXCHANGE: 'foc.events',
  RABBITMQ_USER_REGISTERED_QUEUE: 'credit-service.user-registered.v1',
  RABBITMQ_USER_REGISTERED_ROUTING_KEY: 'user.registered.v1',
  RABBITMQ_CREDIT_ACCOUNT_INITIALISED_ROUTING_KEY:
    'credit.account-initialised.v1',
  RABBITMQ_RETRY_EXCHANGE: 'foc.credit.retry',
  RABBITMQ_RETRY_RETURN_EXCHANGE: 'foc.credit.back',
  RABBITMQ_DEAD_LETTER_EXCHANGE: 'foc.credit.dlx',
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
  constructor(private readonly consumerTag = 'consumer-tag') {
    super();
  }
  readonly assertedExchanges: unknown[][] = [];
  readonly checkedExchanges: string[] = [];
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

  async checkExchange(exchange: string): Promise<{ exchange: string }> {
    this.checkedExchanges.push(exchange);
    return { exchange };
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
    return { consumerTag: this.consumerTag };
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
  readonly publisher = new FakeChannel();
  readonly consumers: FakeChannel[] = [];
  closed = false;
  closeCalls = 0;

  get consumer(): FakeChannel {
    return this.consumers[0];
  }

  async createChannel(): Promise<FakeChannel> {
    const channel = new FakeChannel(
      `consumer-tag-${this.consumers.length + 1}`,
    );
    this.consumers.push(channel);
    return channel;
  }

  async createConfirmChannel(): Promise<FakeChannel> {
    return this.publisher;
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
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
    exchange?: string;
    routingKey?: string;
    headers?: Record<string, unknown>;
    userId?: string;
  } = {},
): ConsumeMessage {
  return {
    content: body,
    fields: {
      consumerTag: 'consumer-tag',
      deliveryTag: 1,
      redelivered: false,
      exchange: overrides.exchange ?? 'foc.events',
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
      userId: overrides.userId,
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
  const transport = new RabbitMqConsumerTransport(
    config,
    'amqp://credit-service:test@rabbitmq:5672/%2Ffoc',
    connect,
  );

  return {
    connect,
    handler,
    model,
    transport,
    getRecoverySetup: () => recoverySetup,
  };
}

function subscription(
  handler: RabbitMqMessageHandler,
  overrides: Partial<Subscription> = {},
): Subscription {
  return {
    queue: 'credit-service.user-registered.v1',
    routingKey: 'user.registered.v1',
    handler,
    ...overrides,
  };
}

async function deliver(
  model: FakeModel,
  delivery: ConsumeMessage,
): Promise<void> {
  model.consumer.onMessage?.(delivery);
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function deliverOn(
  channel: FakeChannel,
  delivery: ConsumeMessage,
): Promise<void> {
  channel.onMessage?.(delivery);
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('RabbitMqConsumerTransport', () => {
  it('declares the durable topology and starts a manual-ack consumer', async () => {
    const { connect, model, transport } = createHarness();

    await transport.subscribe(
      subscription({
        handle: vi.fn().mockResolvedValue({ outcome: 'ack' }),
      }),
    );

    expect(connect).toHaveBeenCalledWith(
      'amqp://credit-service:test@rabbitmq:5672/%2Ffoc',
      expect.objectContaining({ recovery: expect.any(Object) }),
    );
    expect(model.publisher.assertedExchanges).toEqual([
      ['foc.credit.retry', 'direct', { durable: true }],
      ['foc.credit.back', 'direct', { durable: true }],
      ['foc.credit.dlx', 'direct', { durable: true }],
    ]);
    expect(model.publisher.checkedExchanges).toEqual(['foc.events']);
    expect(model.consumer.assertedQueues).toEqual([
      ['credit-service.user-registered.v1', { durable: true }],
      ...configuration.RABBITMQ_RETRY_DELAYS_MS.map((delay, index) => [
        `credit-service.user-registered.v1.retry.${index + 1}`,
        {
          durable: true,
          messageTtl: delay,
          deadLetterExchange: 'foc.credit.back',
          deadLetterRoutingKey: 'credit-service.user-registered.v1',
        },
      ]),
      ['credit-service.user-registered.v1.dlq', { durable: true }],
    ]);
    expect(model.consumer.bindings).toEqual([
      ['credit-service.user-registered.v1', 'foc.events', 'user.registered.v1'],
      [
        'credit-service.user-registered.v1',
        'foc.credit.back',
        'credit-service.user-registered.v1',
      ],
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

  it('rejects a duplicate queue subscription', async () => {
    const { handler, transport } = createHarness();
    await transport.subscribe(subscription(handler));

    await expect(transport.subscribe(subscription(handler))).rejects.toThrow(
      'already subscribed',
    );
  });

  it('registers concurrent streams on one connection with isolated channels', async () => {
    const firstHandler = {
      handle: vi.fn().mockResolvedValue({ outcome: 'ack' }),
    } satisfies RabbitMqMessageHandler;
    const secondHandler = {
      handle: vi.fn().mockResolvedValue({ outcome: 'ack' }),
    } satisfies RabbitMqMessageHandler;
    const { connect, model, transport } = createHarness();

    await Promise.all([
      transport.subscribe(subscription(firstHandler)),
      transport.subscribe(
        subscription(secondHandler, {
          queue: 'credit-service.credit-reservation.v1',
          routingKey: 'credit.reservation.v1',
          deadLetterQueue: 'credit-service.credit-reservation.failures',
        }),
      ),
    ]);

    expect(connect).toHaveBeenCalledOnce();
    expect(model.publisher.assertedExchanges).toHaveLength(3);
    expect(model.publisher.checkedExchanges).toEqual(['foc.events']);
    expect(model.consumers).toHaveLength(2);
    expect(model.consumers.map(({ prefetchCount }) => prefetchCount)).toEqual([
      10, 10,
    ]);
    expect(model.consumers[1].assertedQueues).toContainEqual([
      'credit-service.credit-reservation.failures',
      { durable: true },
    ]);

    await deliverOn(
      model.consumers[1],
      message(undefined, { routingKey: 'credit.reservation.v1' }),
    );
    expect(secondHandler.handle).toHaveBeenCalledOnce();
    expect(firstHandler.handle).not.toHaveBeenCalled();
  });

  it('rejects invalid and colliding subscription topology names', async () => {
    const { handler, transport } = createHarness();

    await expect(
      transport.subscribe(subscription(handler, { queue: ' queue' })),
    ).rejects.toThrow('must be non-empty');
    await transport.subscribe(
      subscription(handler, { deadLetterQueue: 'shared-failures' }),
    );
    await expect(
      transport.subscribe(
        subscription(handler, {
          queue: 'shared-failures',
          routingKey: 'another.event.v1',
        }),
      ),
    ).rejects.toThrow('already in use');
  });

  it('adds a subscription after the connection is already active', async () => {
    const { connect, handler, model, transport } = createHarness();
    await transport.subscribe(subscription(handler));

    await transport.subscribe(
      subscription(handler, {
        queue: 'credit-service.later.v1',
        routingKey: 'later.event.v1',
      }),
    );

    expect(connect).toHaveBeenCalledOnce();
    expect(model.consumers).toHaveLength(2);
    expect(model.consumers[1].bindings).toContainEqual([
      'credit-service.later.v1',
      'foc.events',
      'later.event.v1',
    ]);
  });

  it('passes decoded input to the handler and acknowledges success', async () => {
    const handler = {
      handle: vi.fn().mockResolvedValue({ outcome: 'ack' }),
    } satisfies RabbitMqMessageHandler;
    const { model, transport } = createHarness(handler);
    await transport.subscribe(subscription(handler));
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

  it('accepts a returned retry and exposes its logical domain route', async () => {
    const handler = {
      handle: vi.fn().mockResolvedValue({ outcome: 'ack' }),
    } satisfies RabbitMqMessageHandler;
    const { model, transport } = createHarness(handler);
    await transport.subscribe(subscription(handler));
    const delivery = message(undefined, {
      exchange: 'foc.credit.back',
      routingKey: 'credit-service.user-registered.v1',
      headers: { 'x-retry-count': 1 },
    });

    await deliver(model, delivery);

    expect(handler.handle).toHaveBeenCalledWith(
      expect.objectContaining({
        routingKey: 'user.registered.v1',
        retryCount: 1,
      }),
    );
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
      name: 'an initial attempt on the retry-return route',
      delivery: message(undefined, {
        exchange: 'foc.credit.back',
        routingKey: 'credit-service.user-registered.v1',
      }),
      category: 'ROUTING_KEY_MISMATCH',
    },
    {
      name: 'a retry on the shared domain route',
      delivery: message(undefined, { headers: { 'x-retry-count': 1 } }),
      category: 'ROUTING_KEY_MISMATCH',
    },
    {
      name: 'a retry returned for another queue',
      delivery: message(undefined, {
        exchange: 'foc.credit.back',
        routingKey: 'credit-service.other-stream.v1',
        headers: { 'x-retry-count': 1 },
      }),
      category: 'ROUTING_KEY_MISMATCH',
    },
    {
      name: 'a delivery from an unrelated exchange',
      delivery: message(undefined, {
        exchange: 'foc.unrelated',
        headers: { 'x-retry-count': 1 },
      }),
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
      await transport.subscribe(subscription(handler));

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
    await transport.subscribe(subscription(handler));
    const delivery = message(undefined, {
      headers: {
        trace: 'preserved',
        'x-event-id': 'spoofed',
        'x-failure-category': 'spoofed',
      },
      userId: 'user-service',
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
    expect(model.publisher.published[0].options).not.toHaveProperty('userId');
    expect(model.consumer.acknowledged).toEqual([delivery]);
  });

  it('dead-letters the sixth failed processing attempt', async () => {
    const handler = {
      handle: vi.fn().mockRejectedValue(new Error('still unavailable')),
    } satisfies RabbitMqMessageHandler;
    const { model, transport } = createHarness(handler);
    await transport.subscribe(subscription(handler));
    const delivery = message(undefined, {
      exchange: 'foc.credit.back',
      routingKey: 'credit-service.user-registered.v1',
      headers: { 'x-retry-count': 5 },
    });

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
    await transport.subscribe(subscription(handler));
    await deliver(model, message(undefined, { userId: 'user-service' }));

    const headers = model.publisher.published[0].options.headers;
    expect(headers['x-failure-category']).toBe('INVALID_PAYLOAD');
    expect(headers['x-failure-reason']).not.toContain('\n');
    expect(headers['x-failure-reason']).toHaveLength(512);
    expect(model.publisher.published[0].options).not.toHaveProperty('userId');
  });

  it('waits for publisher confirmation before acknowledging', async () => {
    const handler = {
      handle: vi.fn().mockRejectedValue(new Error('temporary')),
    } satisfies RabbitMqMessageHandler;
    const { model, transport } = createHarness(handler);
    model.publisher.automaticConfirmation = false;
    await transport.subscribe(subscription(handler));
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
    await transport.subscribe(subscription(handler));
    const delivery = message();

    await deliver(model, delivery);

    expect(model.consumer.acknowledged).toHaveLength(0);
    expect(model.consumer.rejected).toEqual([
      { message: delivery, allUpTo: false, requeue: true },
    ]);
  });

  it('redeclares every subscription through the recovery setup callback', async () => {
    const { getRecoverySetup, handler, model, transport } = createHarness();
    await transport.subscribe(subscription(handler));
    await transport.subscribe(
      subscription(handler, {
        queue: 'credit-service.credit-reservation.v1',
        routingKey: 'credit.reservation.v1',
      }),
    );
    const recoveredModel = new FakeModel();

    await (getRecoverySetup() as (model: ChannelModel) => Promise<void>)(
      recoveredModel as unknown as ChannelModel,
    );

    expect(recoveredModel.consumers).toHaveLength(2);
    expect(recoveredModel.consumers[0].assertedQueues).toEqual(
      model.consumers[0].assertedQueues,
    );
    expect(recoveredModel.consumers[1].assertedQueues).toEqual(
      model.consumers[1].assertedQueues,
    );
    expect(recoveredModel.publisher.assertedExchanges).toHaveLength(3);
    expect(recoveredModel.publisher.checkedExchanges).toEqual(['foc.events']);
  });

  it('recycles the connection once when current consumer channels close', async () => {
    const { handler, model, transport } = createHarness();
    await transport.subscribe(subscription(handler));
    await transport.subscribe(
      subscription(handler, {
        queue: 'credit-service.credit-reservation.v1',
        routingKey: 'credit.reservation.v1',
      }),
    );

    model.consumers[0].emit('close');
    model.consumers[1].emit('close');
    await vi.waitFor(() => expect(model.closeCalls).toBe(1));
  });

  it('retains a subscription registered while connection recovery is pending', async () => {
    const { getRecoverySetup, handler, model, transport } = createHarness();
    await transport.subscribe(subscription(handler));
    model.consumer.emit('close');
    await vi.waitFor(() => expect(model.closeCalls).toBe(1));

    let installed = false;
    const subscribing = transport
      .subscribe(
        subscription(handler, {
          queue: 'credit-service.during-recovery.v1',
          routingKey: 'during-recovery.event.v1',
        }),
      )
      .then(() => {
        installed = true;
      });
    await Promise.resolve();
    expect(installed).toBe(false);

    const recoveredModel = new FakeModel();
    await (getRecoverySetup() as (model: ChannelModel) => Promise<void>)(
      recoveredModel as unknown as ChannelModel,
    );
    await subscribing;

    expect(recoveredModel.consumers).toHaveLength(2);
    expect(recoveredModel.consumers[1].bindings).toContainEqual([
      'credit-service.during-recovery.v1',
      'foc.events',
      'during-recovery.event.v1',
    ]);
  });

  it('rejects subscriptions after shutdown', async () => {
    const { handler, transport } = createHarness();
    await transport.close();

    await expect(transport.subscribe(subscription(handler))).rejects.toThrow(
      'shutting down',
    );
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
    await transport.subscribe(subscription(handler));
    model.consumer.onMessage?.(message());
    await vi.waitFor(() => expect(handler.handle).toHaveBeenCalled());

    let closed = false;
    const closing = transport.close().then(() => {
      closed = true;
    });
    await vi.waitFor(() =>
      expect(model.consumer.cancelled).toEqual(['consumer-tag-1']),
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
