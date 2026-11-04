import { EventEmitter } from 'node:events';
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
  COMMS_LIFECYCLE_STREAMS,
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
  ackError?: Error;

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
  confirmationError: Error | null = null;

  publish(
    exchange: string,
    routingKey: string,
    content: Buffer,
    options: Options.Publish,
    callback: (error: Error | null) => void,
  ) {
    this.publications.push({
      exchange,
      routingKey,
      content,
      options,
      callback,
    });
    if (this.autoConfirm) callback(this.confirmationError);
    return true;
  }

  async close() {
    this.closed = true;
    this.emit('close');
  }
}

class FakeConnection {
  readonly consumers: FakeConsumerChannel[] = [];
  readonly publisher = new FakePublisherChannel();
  beforeClose?: () => Promise<void>;

  async createChannel() {
    const channel = new FakeConsumerChannel();
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

const [acceptedStream] = COMMS_LIFECYCLE_STREAMS;

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
    ...acceptedStream,
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

describe('RabbitMqConsumerTransport', () => {
  it('installs one manual-ack channel per known lifecycle stream without declaring topology', async () => {
    const { connection, handler, transport } = harness();
    await transport.subscribeAll(
      COMMS_LIFECYCLE_STREAMS.map((stream) => ({ ...stream, handler })),
    );

    expect(connection.consumers).toHaveLength(COMMS_LIFECYCLE_STREAMS.length);
    for (const [index, stream] of COMMS_LIFECYCLE_STREAMS.entries()) {
      const channel = connection.consumers[index];
      expect(channel.checkedQueues).toEqual([stream.queue]);
      expect(channel.prefetches).toEqual([10]);
      expect(channel.consumeCalls).toEqual([
        { queue: stream.queue, options: { noAck: false } },
      ]);
      expect(channel).not.toHaveProperty('assertQueue');
      expect(channel).not.toHaveProperty('assertExchange');
      expect(channel).not.toHaveProperty('bindQueue');
    }
  });

  it('rejects unknown queues, mismatched routes, and duplicate registration', async () => {
    const { subscription, transport } = harness();
    await expect(
      transport.subscribe({ ...subscription, queue: 'another.queue' }),
    ).rejects.toThrow('not a known lifecycle stream');
    await expect(
      transport.subscribe({ ...subscription, routingKey: 'wrong.route' }),
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

  it('accepts the stream-specific retry-return route and reports the logical route', async () => {
    const { connection, handleMock, subscription, transport } = harness();
    await transport.subscribe(subscription);
    const delivery = message({
      exchange: COMMS_RETRY_RETURN_EXCHANGE,
      routingKey: acceptedStream.queue,
      headers: { 'x-retry-count': 2 },
    });
    await deliver(connection, delivery);

    expect(handleMock).toHaveBeenCalledWith(
      expect.objectContaining({
        routingKey: acceptedStream.routingKey,
        retryCount: 2,
      }),
    );
  });

  it.each([
    [
      'wrong route',
      message({ routingKey: 'order.wrong.v1' }),
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
          persistent: true,
          headers: expect.objectContaining({ 'x-failure-category': category }),
        }),
      );
    },
  );

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
        persistent: true,
        headers: expect.objectContaining({
          'x-retry-count': 1,
          'x-failure-category': 'TRANSIENT_PROCESSING_FAILURE',
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
      headers: { 'x-retry-count': 5 },
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
      },
    });
    await deliver(connection, delivery);

    const headers = connection.publisher.publications[0].options.headers;
    expect(headers).toEqual(
      expect.objectContaining({
        traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
        tracestate: 'vendor=value',
        'x-retry-count': 1,
      }),
    );
    expect(headers).not.toHaveProperty('authorization');
    expect(headers).not.toHaveProperty('x-custom');
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

  it('reinstalls an unexpectedly closed stream without disturbing siblings', async () => {
    const { connection, handler, transport } = harness();
    await transport.subscribeAll(
      COMMS_LIFECYCLE_STREAMS.slice(0, 2).map((stream) => ({
        ...stream,
        handler,
      })),
    );
    await connection.consumers[0].close();

    await vi.waitFor(() => expect(connection.consumers).toHaveLength(3));
    expect(connection.consumers[2].checkedQueues).toEqual([
      COMMS_LIFECYCLE_STREAMS[0].queue,
    ]);
    expect(connection.consumers[1].closed).toBe(false);
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
  });
});
