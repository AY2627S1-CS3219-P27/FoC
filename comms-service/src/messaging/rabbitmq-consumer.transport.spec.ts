import { EventEmitter } from 'node:events';
import {
  ORDER_ERRAND_ACCEPTED_V1_ROUTING_KEY,
  ORDER_COURIER_CANCELLED_V1_ROUTING_KEY,
  ORDER_ERRAND_CANCELLED_V1_ROUTING_KEY,
  ORDER_ERRAND_DELIVERED_V1_ROUTING_KEY,
} from '@foc/contracts';
import type { Channel, ConfirmChannel, ConsumeMessage, Options } from 'amqplib';
import { RabbitMqConnectionService } from './rabbitmq-connection.service.js';
import { RabbitMqConsumerTransport } from './rabbitmq-consumer.transport.js';
import type {
  LifecycleMessageHandler,
  LifecycleSubscription,
} from './rabbitmq-message.types.js';
import {
  COMMS_DEAD_LETTER_EXCHANGE,
  COMMS_DOMAIN_EXCHANGE,
  COMMS_EVENTS_QUEUE,
  COMMS_PUBSUB_EXCHANGE,
  COMMS_RETRY_EXCHANGE,
  COMMS_RETRY_RETURN_EXCHANGE,
} from './rabbitmq-topology.js';

class FakeConsumerChannel extends EventEmitter {
  readonly checkedQueues: string[] = [];
  readonly prefetches: number[] = [];
  readonly consumeCalls: Array<{
    queue: string;
    options?: Options.Consume;
  }> = [];
  readonly acknowledged: ConsumeMessage[] = [];
  readonly cancelled: string[] = [];
  consumeCallback?: (message: ConsumeMessage | null) => void;
  closed = false;
  closeWhenListenerRegistered = false;
  ackError?: Error;

  override on(event: string, listener: () => void): this {
    super.on(event, listener);
    if (event === 'close' && this.closeWhenListenerRegistered) {
      this.closeWhenListenerRegistered = false;
      void this.close();
    }
    return this;
  }

  async checkQueue(queue: string) {
    this.checkedQueues.push(queue);
    return { queue, messageCount: 0, consumerCount: 0 };
  }

  async prefetch(count: number) {
    this.prefetches.push(count);
  }

  async consume(
    queue: string,
    callback: (message: ConsumeMessage | null) => void,
    options?: Options.Consume,
  ) {
    this.consumeCalls.push({ queue, options });
    this.consumeCallback = callback;
    return { consumerTag: `consumer-${queue}` };
  }

  ack(message: ConsumeMessage) {
    if (this.ackError) throw this.ackError;
    this.acknowledged.push(message);
  }

  async cancel(tag: string) {
    this.cancelled.push(tag);
    return {};
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    this.emit('close');
  }
}

interface Publication {
  exchange: string;
  routingKey: string;
  content: Buffer;
  options: Options.Publish;
  callback: (error: Error | null) => void;
}

class FakePublisherChannel extends EventEmitter {
  readonly publications: Publication[] = [];
  waitForConfirms = vi.fn().mockResolvedValue(undefined);
  closed = false;
  autoConfirm = true;
  returnOnPublish = false;
  confirmationError: Error | null = null;

  publish(
    exchange: string,
    routingKey: string,
    content: Buffer,
    options: Options.Publish,
    callback: (error: Error | null) => void,
  ) {
    const publication = {
      exchange,
      routingKey,
      content,
      options,
      callback,
    };
    this.publications.push(publication);
    if (this.returnOnPublish) {
      this.returnPublication(this.publications.length - 1);
    }
    if (this.autoConfirm) callback(this.confirmationError);
    return true;
  }

  returnPublication(index: number) {
    const publication = this.publications[index];
    this.emit('return', {
      content: publication.content,
      fields: {
        exchange: publication.exchange,
        routingKey: publication.routingKey,
      },
      properties: publication.options,
    });
  }

  async close() {
    this.closed = true;
    this.emit('close');
  }
}

class FakeConnection {
  readonly consumers: FakeConsumerChannel[] = [];
  readonly publisher = new FakePublisherChannel();
  readonly stopRecovery = vi.fn().mockResolvedValue(undefined);
  beforeClose?: () => Promise<void>;
  closeNextConsumerWhenListenerRegistered = false;

  async createChannel() {
    const channel = new FakeConsumerChannel();
    channel.closeWhenListenerRegistered =
      this.closeNextConsumerWhenListenerRegistered;
    this.closeNextConsumerWhenListenerRegistered = false;
    this.consumers.push(channel);
    return channel as unknown as Channel;
  }

  async createConfirmChannel() {
    return this.publisher as unknown as ConfirmChannel;
  }

  registerBeforeClose(callback: () => Promise<void>) {
    this.beforeClose = callback;
    return () => {
      if (this.beforeClose === callback) this.beforeClose = undefined;
    };
  }
}

const acceptedStream = {
  queue: COMMS_EVENTS_QUEUE,
  routingKey: ORDER_ERRAND_ACCEPTED_V1_ROUTING_KEY,
};

function message(
  overrides: {
    exchange?: string;
    routingKey?: string;
    body?: string | Buffer;
    headers?: Record<string, unknown>;
    contentType?: string;
    contentEncoding?: string;
  } = {},
): ConsumeMessage {
  const body =
    overrides.body ??
    JSON.stringify({
      eventId: '7f0f433b-69f9-4fd7-b4a9-fdb14db5eadd',
      eventType: 'ErrandAccepted',
    });
  return {
    content: Buffer.isBuffer(body) ? body : Buffer.from(body),
    fields: {
      consumerTag: 'consumer',
      deliveryTag: 1,
      redelivered: false,
      exchange: overrides.exchange ?? COMMS_DOMAIN_EXCHANGE,
      routingKey: overrides.routingKey ?? acceptedStream.routingKey,
    },
    properties: {
      contentType: overrides.contentType ?? 'application/json',
      contentEncoding: overrides.contentEncoding ?? 'utf-8',
      headers: overrides.headers ?? {},
      deliveryMode: 2,
      priority: undefined,
      correlationId: 'correlation-id',
      replyTo: undefined,
      expiration: undefined,
      messageId: 'broker-message-id',
      timestamp: 1_799_000_000,
      type: 'ErrandAccepted',
      userId: 'order-service',
      appId: 'order-service',
      clusterId: undefined,
    },
  };
}

function harness(
  result: Awaited<ReturnType<LifecycleMessageHandler['handle']>> = {
    outcome: 'processed',
  },
) {
  const connection = new FakeConnection();
  const handleMock = vi
    .fn<LifecycleMessageHandler['handle']>()
    .mockResolvedValue(result);
  const handler: LifecycleMessageHandler = {
    handle: handleMock,
  };
  const subscription: LifecycleSubscription = {
    queue: COMMS_EVENTS_QUEUE,
    handler,
  };
  const transport = new RabbitMqConsumerTransport(
    connection as unknown as RabbitMqConnectionService,
  );
  return { connection, handleMock, handler, subscription, transport };
}

async function deliver(
  connection: FakeConnection,
  delivery: ConsumeMessage,
  index = 0,
) {
  connection.consumers[index].consumeCallback?.(delivery);
  await vi.waitFor(() => {
    const handled = connection.consumers[index].acknowledged.includes(delivery);
    const published = connection.publisher.publications.length > 0;
    expect(
      handled || published || connection.consumers.length > index + 1,
    ).toBe(true);
  });
}

async function flushMicrotasks(): Promise<void> {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
}

describe('RabbitMqConsumerTransport', () => {
  it('installs one manual-ack channel for the unified event stream without declaring topology', async () => {
    const { connection, handler, transport } = harness();
    await transport.subscribe({ queue: COMMS_EVENTS_QUEUE, handler });

    expect(connection.consumers).toHaveLength(1);
    const channel = connection.consumers[0];
    expect(channel.checkedQueues).toEqual([COMMS_EVENTS_QUEUE]);
    expect(channel.prefetches).toEqual([10]);
    expect(channel.consumeCalls).toEqual([
      { queue: COMMS_EVENTS_QUEUE, options: { noAck: false } },
    ]);
    expect(channel).not.toHaveProperty('assertQueue');
    expect(channel).not.toHaveProperty('assertExchange');
    expect(channel).not.toHaveProperty('bindQueue');
  });

  it('rejects unknown queues and duplicate registration', async () => {
    const { subscription, transport } = harness();
    await expect(
      transport.subscribe({ ...subscription, queue: 'another.queue' }),
    ).rejects.toThrow('not a known lifecycle stream');
    await transport.subscribe(subscription);
    await expect(transport.subscribe(subscription)).rejects.toThrow(
      'already subscribed',
    );
  });

  it.each(['processed', 'duplicate'] as const)(
    'acknowledges an explicit %s outcome after the handler resolves',
    async (outcome) => {
      const { connection, handleMock, subscription, transport } = harness({
        outcome,
      });
      await transport.subscribe(subscription);
      const delivery = message();
      await deliver(connection, delivery);

      expect(handleMock).toHaveBeenCalledWith(
        expect.objectContaining({
          routingKey: acceptedStream.routingKey,
          retryCount: 0,
          eventId: '7f0f433b-69f9-4fd7-b4a9-fdb14db5eadd',
        }),
      );
      expect(connection.consumers[0].acknowledged).toEqual([delivery]);
      expect(connection.publisher.publications).toHaveLength(0);
    },
  );

  it.each([
    ORDER_ERRAND_ACCEPTED_V1_ROUTING_KEY,
    ORDER_ERRAND_DELIVERED_V1_ROUTING_KEY,
    ORDER_COURIER_CANCELLED_V1_ROUTING_KEY,
    ORDER_ERRAND_CANCELLED_V1_ROUTING_KEY,
  ])('dispatches the supported lifecycle route %s', async (routingKey) => {
    const { connection, handleMock, subscription, transport } = harness();
    await transport.subscribe(subscription);
    const delivery = message({ routingKey });
    await deliver(connection, delivery);

    expect(handleMock).toHaveBeenCalledWith(
      expect.objectContaining({ routingKey }),
    );
    expect(connection.consumers[0].acknowledged).toEqual([delivery]);
  });

  it('accepts the stream-specific retry-return route and reports the logical route', async () => {
    const { connection, handleMock, subscription, transport } = harness();
    await transport.subscribe(subscription);
    const delivery = message({
      exchange: COMMS_RETRY_RETURN_EXCHANGE,
      routingKey: acceptedStream.queue,
      headers: {
        'x-retry-count': 2,
        'x-comms-original-routing-key': acceptedStream.routingKey,
      },
    });
    await deliver(connection, delivery);

    expect(handleMock).toHaveBeenCalledWith(
      expect.objectContaining({
        routingKey: acceptedStream.routingKey,
        retryCount: 2,
      }),
    );
  });

  it.each([undefined, 'order.spoofed.v1'])(
    'dead-letters retry-return delivery with invalid original route %s',
    async (routingKey) => {
      const { connection, handleMock, subscription, transport } = harness();
      await transport.subscribe(subscription);
      const headers: Record<string, unknown> = { 'x-retry-count': 2 };
      if (routingKey) headers['x-comms-original-routing-key'] = routingKey;
      const delivery = message({
        exchange: COMMS_RETRY_RETURN_EXCHANGE,
        routingKey: COMMS_EVENTS_QUEUE,
        headers,
      });
      await deliver(connection, delivery);

      expect(handleMock).not.toHaveBeenCalled();
      expect(
        connection.publisher.publications[0].options.headers,
      ).toMatchObject({ 'x-failure-category': 'ROUTING_KEY_MISMATCH' });
    },
  );

  it.each([
    [
      'wrong route',
      message({ exchange: COMMS_PUBSUB_EXCHANGE }),
      'ROUTING_KEY_MISMATCH',
    ],
    [
      'invalid retry metadata',
      message({ headers: { 'x-retry-count': 99 } }),
      'INVALID_RETRY_METADATA',
    ],
    [
      'wrong content type',
      message({ contentType: 'text/plain' }),
      'INVALID_CONTENT_METADATA',
    ],
    [
      'wrong encoding',
      message({ contentEncoding: 'gzip' }),
      'INVALID_CONTENT_METADATA',
    ],
    ['malformed JSON', message({ body: '{' }), 'MALFORMED_JSON'],
    [
      'invalid UTF-8',
      message({ body: Buffer.from([0xc3, 0x28]) }),
      'MALFORMED_JSON',
    ],
  ])(
    'dead-letters %s before application handling',
    async (_name, delivery, category) => {
      const { connection, handleMock, subscription, transport } = harness();
      await transport.subscribe(subscription);
      await deliver(connection, delivery as ConsumeMessage);

      expect(handleMock).not.toHaveBeenCalled();
      const publication = connection.publisher.publications[0];
      expect(publication.exchange).toBe(COMMS_DEAD_LETTER_EXCHANGE);
      expect(publication.routingKey).toBe(`${acceptedStream.queue}.dlq`);
      expect(publication.options).toEqual(
        expect.objectContaining({
          mandatory: true,
          persistent: true,
          headers: expect.objectContaining({ 'x-failure-category': category }),
        }),
      );
    },
  );

  it('acknowledges unsupported Order events without handling or publishing', async () => {
    const { connection, handleMock, subscription, transport } = harness();
    await transport.subscribe(subscription);
    const delivery = message({
      routingKey: 'order.some-future-fact.v1',
      body: '{',
      headers: { 'x-comms-original-routing-key': acceptedStream.routingKey },
    });
    await deliver(connection, delivery);

    expect(handleMock).not.toHaveBeenCalled();
    expect(connection.consumers[0].acknowledged).toEqual([delivery]);
    expect(connection.publisher.publications).toHaveLength(0);
  });

  it('publishes a transient result to the next retry queue and waits for confirmation before ack', async () => {
    const { connection, subscription, transport } = harness({
      outcome: 'transient-failure',
      reason: 'database unavailable',
    });
    connection.publisher.autoConfirm = false;
    await transport.subscribe(subscription);
    const delivery = message();
    connection.consumers[0].consumeCallback?.(delivery);

    await vi.waitFor(() =>
      expect(connection.publisher.publications).toHaveLength(1),
    );
    const publication = connection.publisher.publications[0];
    expect(publication.exchange).toBe(COMMS_RETRY_EXCHANGE);
    expect(publication.routingKey).toBe(`${acceptedStream.queue}.retry.1`);
    expect(publication.options).toEqual(
      expect.objectContaining({
        mandatory: true,
        persistent: true,
        headers: expect.objectContaining({
          'x-retry-count': 1,
          'x-failure-category': 'TRANSIENT_PROCESSING_FAILURE',
          'x-comms-original-routing-key': acceptedStream.routingKey,
        }),
      }),
    );
    expect(connection.consumers[0].acknowledged).toHaveLength(0);

    publication.callback(null);
    await vi.waitFor(() =>
      expect(connection.consumers[0].acknowledged).toEqual([delivery]),
    );
  });

  it('treats thrown handler errors as transient and dead-letters after five retries', async () => {
    const { connection, handleMock, subscription, transport } = harness();
    handleMock.mockRejectedValue(new Error('database offline'));
    await transport.subscribe(subscription);
    const delivery = message({
      exchange: COMMS_RETRY_RETURN_EXCHANGE,
      routingKey: acceptedStream.queue,
      headers: {
        'x-retry-count': 5,
        'x-comms-original-routing-key': acceptedStream.routingKey,
      },
    });
    await deliver(connection, delivery);

    const publication = connection.publisher.publications[0];
    expect(publication.exchange).toBe(COMMS_DEAD_LETTER_EXCHANGE);
    expect(publication.options.headers).toEqual(
      expect.objectContaining({
        'x-retry-count': 5,
        'x-failure-category': 'PROCESSING_RETRIES_EXHAUSTED',
      }),
    );
  });

  it('dead-letters an explicit identity conflict without retrying', async () => {
    const { connection, subscription, transport } = harness({
      outcome: 'permanent-failure',
      category: 'IDENTITY_CONFLICT',
      reason: 'event ID has different canonical evidence',
    });
    await transport.subscribe(subscription);
    await deliver(connection, message());

    const publication = connection.publisher.publications[0];
    expect(publication.exchange).toBe(COMMS_DEAD_LETTER_EXCHANGE);
    expect(publication.options.headers).toEqual(
      expect.objectContaining({ 'x-failure-category': 'IDENTITY_CONFLICT' }),
    );
  });

  it('preserves only bounded tracing metadata on replacement publications', async () => {
    const { connection, subscription, transport } = harness({
      outcome: 'transient-failure',
      reason: 'temporary',
    });
    await transport.subscribe(subscription);
    const delivery = message({
      headers: {
        traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
        tracestate: 'vendor=value',
        authorization: 'secret',
        'x-custom': 'not-forwarded',
        'x-retry-count': 0,
        'x-comms-publication-id': 'untrusted-upstream-value',
        'x-comms-original-routing-key': 'order.spoofed.v1',
      },
    });
    await deliver(connection, delivery);

    const headers = connection.publisher.publications[0].options.headers;
    expect(connection.publisher.publications[0].options.correlationId).toBe(
      'correlation-id',
    );
    expect(headers).toEqual(
      expect.objectContaining({
        traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
        tracestate: 'vendor=value',
        'x-retry-count': 1,
        'x-comms-original-routing-key': acceptedStream.routingKey,
      }),
    );
    expect(headers).not.toHaveProperty('authorization');
    expect(headers).not.toHaveProperty('x-custom');
    expect(headers?.['x-comms-publication-id']).toEqual(expect.any(String));
    expect(headers?.['x-comms-publication-id']).not.toBe(
      'untrusted-upstream-value',
    );
  });

  it('leaves the original recoverable when a retry publication is returned', async () => {
    const { connection, subscription, transport } = harness({
      outcome: 'transient-failure',
      reason: 'temporary',
    });
    connection.publisher.returnOnPublish = true;
    await transport.subscribe(subscription);
    const delivery = message();
    connection.consumers[0].consumeCallback?.(delivery);

    await vi.waitFor(() => expect(connection.consumers).toHaveLength(2));
    expect(connection.publisher.publications[0].options.mandatory).toBe(true);
    expect(connection.consumers[0].acknowledged).toHaveLength(0);
    expect(connection.consumers[0].closed).toBe(true);
  });

  it('leaves the original recoverable when a dead-letter publication is returned', async () => {
    const { connection, subscription, transport } = harness({
      outcome: 'permanent-failure',
      category: 'INVALID_PAYLOAD',
      reason: 'invalid payload',
    });
    connection.publisher.returnOnPublish = true;
    await transport.subscribe(subscription);
    const delivery = message();
    connection.consumers[0].consumeCallback?.(delivery);

    await vi.waitFor(() => expect(connection.consumers).toHaveLength(2));
    expect(connection.publisher.publications[0].options.mandatory).toBe(true);
    expect(connection.consumers[0].acknowledged).toHaveLength(0);
    expect(connection.consumers[0].closed).toBe(true);
  });

  it('correlates a returned publication without failing concurrent publications', async () => {
    const { connection, handler, transport } = harness({
      outcome: 'transient-failure',
      reason: 'temporary',
    });
    connection.publisher.autoConfirm = false;
    await transport.subscribe({ queue: COMMS_EVENTS_QUEUE, handler });
    const acceptedDelivery = message();
    const deliveredDelivery = message({
      routingKey: ORDER_ERRAND_DELIVERED_V1_ROUTING_KEY,
      body: JSON.stringify({
        eventId: 'd08417e5-7230-4bb5-a033-304127d84ac3',
        eventType: 'ErrandDelivered',
      }),
    });
    connection.consumers[0].consumeCallback?.(acceptedDelivery);
    connection.consumers[0].consumeCallback?.(deliveredDelivery);

    await vi.waitFor(() =>
      expect(connection.publisher.publications).toHaveLength(2),
    );
    const returnedIndex = 0;
    const successfulIndex = 1;
    connection.publisher.publications[successfulIndex].callback(null);
    await vi.waitFor(() =>
      expect(connection.consumers[0].acknowledged).toEqual([deliveredDelivery]),
    );
    connection.publisher.returnPublication(returnedIndex);
    connection.publisher.publications[returnedIndex].callback(null);

    await vi.waitFor(() => expect(connection.consumers).toHaveLength(2));
    expect(connection.consumers[0].acknowledged).not.toContain(
      acceptedDelivery,
    );
    expect(connection.consumers[0].closed).toBe(true);
  });

  it('leaves the original unacknowledged and replaces only its consumer when publication is nacked', async () => {
    const { connection, subscription, transport } = harness({
      outcome: 'transient-failure',
      reason: 'temporary',
    });
    connection.publisher.confirmationError = new Error('broker nack');
    await transport.subscribe(subscription);
    const delivery = message();
    connection.consumers[0].consumeCallback?.(delivery);

    await vi.waitFor(() => expect(connection.consumers).toHaveLength(2));
    expect(connection.consumers[0].acknowledged).toHaveLength(0);
    expect(connection.consumers[0].closed).toBe(true);
    expect(connection.consumers[1].checkedQueues).toEqual([
      acceptedStream.queue,
    ]);
  });

  it('reinstalls the unified consumer after an unexpected close', async () => {
    const { connection, handler, transport } = harness();
    await transport.subscribe({ queue: COMMS_EVENTS_QUEUE, handler });
    await connection.consumers[0].close();

    await vi.waitFor(() => expect(connection.consumers).toHaveLength(2));
    expect(connection.consumers[1].checkedQueues).toEqual([COMMS_EVENTS_QUEUE]);
    expect(connection.consumers[1].closed).toBe(false);
  });

  it('retries a failed channel-close replacement without an unhandled rejection', async () => {
    vi.useFakeTimers();
    try {
      const { connection, subscription, transport } = harness();
      await transport.subscribe(subscription);
      const createChannel = vi
        .spyOn(connection, 'createChannel')
        .mockRejectedValueOnce(new Error('sensitive connection detail'));

      await connection.consumers[0].close();
      await flushMicrotasks();
      expect(createChannel).toHaveBeenCalledOnce();
      await expect(transport.checkConsumers()).rejects.toThrow(
        'RabbitMQ lifecycle consumers are not ready',
      );
      expect(connection.consumers).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(999);
      expect(createChannel).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(1);
      await flushMicrotasks();
      expect(connection.consumers).toHaveLength(2);

      await expect(transport.checkConsumers()).resolves.toBeUndefined();
      expect(createChannel).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('coalesces broker cancellation and channel-close replacement signals', async () => {
    vi.useFakeTimers();
    try {
      const { connection, subscription, transport } = harness();
      await transport.subscribe(subscription);
      const createChannel = vi
        .spyOn(connection, 'createChannel')
        .mockRejectedValueOnce(new Error('installation failed'));
      const failedChannel = connection.consumers[0];

      failedChannel.consumeCallback?.(null);
      failedChannel.emit('close');
      await flushMicrotasks();
      expect(createChannel).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(1_000);
      await flushMicrotasks();
      expect(connection.consumers).toHaveLength(2);

      expect(createChannel).toHaveBeenCalledTimes(2);
      expect(connection.consumers[1].consumeCalls).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('backs off failed replacements to the sixteen-second cap', async () => {
    vi.useFakeTimers();
    try {
      const { connection, subscription, transport } = harness();
      await transport.subscribe(subscription);
      const createChannel = vi
        .spyOn(connection, 'createChannel')
        .mockRejectedValue(new Error('installation failed'));

      await connection.consumers[0].close();
      await flushMicrotasks();
      expect(createChannel).toHaveBeenCalledOnce();
      for (const [index, delay] of [
        1_000, 2_000, 4_000, 8_000, 16_000, 16_000,
      ].entries()) {
        await vi.advanceTimersByTimeAsync(delay - 1);
        expect(createChannel).toHaveBeenCalledTimes(index + 1);
        await vi.advanceTimersByTimeAsync(1);
        await flushMicrotasks();
        expect(createChannel).toHaveBeenCalledTimes(index + 2);
      }

      await transport.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('continues supervision when a replacement closes before its supervisor exits', async () => {
    const { connection, subscription, transport } = harness();
    await transport.subscribe(subscription);
    connection.closeNextConsumerWhenListenerRegistered = true;

    await connection.consumers[0].close();
    await vi.waitFor(() => expect(connection.consumers).toHaveLength(3));

    expect(connection.consumers[1].closed).toBe(true);
    expect(connection.consumers[2].closed).toBe(false);
    await expect(transport.checkConsumers()).resolves.toBeUndefined();
  });

  it('cancels replacement backoff when shutdown begins', async () => {
    vi.useFakeTimers();
    try {
      const { connection, subscription, transport } = harness();
      await transport.subscribe(subscription);
      const createChannel = vi
        .spyOn(connection, 'createChannel')
        .mockRejectedValueOnce(new Error('installation failed'));

      await connection.consumers[0].close();
      await flushMicrotasks();
      expect(createChannel).toHaveBeenCalledOnce();
      await transport.close();
      await vi.advanceTimersByTimeAsync(16_000);

      expect(createChannel).toHaveBeenCalledOnce();
      expect(connection.stopRecovery).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels intake, drains handlers and confirms, then closes channels', async () => {
    let resolveHandler!: () => void;
    const handlerResult = new Promise<void>((resolve) => {
      resolveHandler = resolve;
    });
    const { connection, handleMock, subscription, transport } = harness();
    handleMock.mockImplementation(async () => {
      await handlerResult;
      return { outcome: 'processed' };
    });
    await transport.subscribe(subscription);
    connection.consumers[0].consumeCallback?.(message());
    await vi.waitFor(() => expect(handleMock).toHaveBeenCalledOnce());

    const closing = transport.close();
    expect(transport.close()).toBe(closing);
    await vi.waitFor(() =>
      expect(connection.consumers[0].cancelled).toEqual([
        `consumer-${acceptedStream.queue}`,
      ]),
    );
    expect(connection.consumers[0].closed).toBe(false);
    resolveHandler();
    await closing;

    expect(connection.publisher.waitForConfirms).toHaveBeenCalledOnce();
    expect(connection.consumers[0].closed).toBe(true);
    expect(connection.publisher.closed).toBe(true);
    expect(connection.beforeClose).toBeUndefined();
    expect(connection.stopRecovery).not.toHaveBeenCalled();
  });

  it('stops recovery after the drain deadline when replacement is waiting for RabbitMQ', async () => {
    vi.useFakeTimers();
    try {
      const { connection, subscription, transport } = harness();
      await transport.subscribe(subscription);
      let markBlocked!: () => void;
      const blocked = new Promise<void>((resolve) => {
        markBlocked = resolve;
      });
      vi.spyOn(connection, 'createChannel').mockImplementationOnce(() => {
        markBlocked();
        return new Promise<Channel>(() => undefined);
      });

      await connection.consumers[0].close();
      await blocked;
      const closing = transport.close();
      await vi.advanceTimersByTimeAsync(9_999);
      expect(connection.stopRecovery).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await closing;

      expect(connection.stopRecovery).toHaveBeenCalledOnce();
      expect(connection.consumers[0].acknowledged).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('interrupts blocked publisher acquisition without acknowledging the delivery', async () => {
    vi.useFakeTimers();
    try {
      const { connection, subscription, transport } = harness({
        outcome: 'transient-failure',
        reason: 'temporary',
      });
      await transport.subscribe(subscription);
      await connection.publisher.close();
      let markBlocked!: () => void;
      const blocked = new Promise<void>((resolve) => {
        markBlocked = resolve;
      });
      vi.spyOn(connection, 'createConfirmChannel').mockImplementationOnce(
        () => {
          markBlocked();
          return new Promise<ConfirmChannel>(() => undefined);
        },
      );
      const delivery = message();
      connection.consumers[0].consumeCallback?.(delivery);
      await blocked;

      const closing = transport.close();
      await vi.advanceTimersByTimeAsync(10_000);
      await closing;

      expect(connection.stopRecovery).toHaveBeenCalledOnce();
      expect(connection.consumers[0].acknowledged).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('closes a consumer channel acquired after shutdown starts without installing it', async () => {
    const { connection, subscription, transport } = harness();
    await transport.subscribe(subscription);
    let markBlocked!: () => void;
    const blocked = new Promise<void>((resolve) => {
      markBlocked = resolve;
    });
    let resolveChannel!: (channel: Channel) => void;
    vi.spyOn(connection, 'createChannel').mockImplementationOnce(
      () =>
        new Promise<Channel>((resolve) => {
          resolveChannel = resolve;
          markBlocked();
        }),
    );
    await connection.consumers[0].close();
    await blocked;

    const closing = transport.close();
    const lateChannel = new FakeConsumerChannel();
    resolveChannel(lateChannel as unknown as Channel);
    await closing;

    expect(lateChannel.closed).toBe(true);
    expect(lateChannel.consumeCalls).toHaveLength(0);
    expect(connection.stopRecovery).not.toHaveBeenCalled();
  });
});
