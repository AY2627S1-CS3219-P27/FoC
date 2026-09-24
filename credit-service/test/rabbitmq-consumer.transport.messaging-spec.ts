import { randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import {
  connect,
  type Channel,
  type ChannelModel,
  type ConfirmChannel,
  type GetMessage,
} from 'amqplib';
import 'dotenv/config';
import type { EnvironmentVariables } from '../src/config/environment.js';
import { RabbitMqConsumerTransport } from '../src/messaging/rabbitmq-consumer.transport.js';
import type {
  IncomingDomainMessage,
  MessageHandlingResult,
  RabbitMqMessageHandler,
} from '../src/messaging/rabbitmq-message.types.js';

const RETRY_DELAYS = [20, 40, 80, 160, 320];

async function waitFor<T>(
  probe: () => Promise<T | undefined> | T | undefined,
  timeoutMs = 5_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await probe();
    if (result !== undefined) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  throw new Error(`Condition was not met within ${timeoutMs}ms`);
}

async function confirmedPublish(
  channel: ConfirmChannel,
  exchange: string,
  routingKey: string,
  body: Buffer,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    channel.publish(
      exchange,
      routingKey,
      body,
      { contentType: 'application/json', persistent: true },
      (error) => (error ? reject(error) : resolve()),
    );
  });
}

describe('RabbitMqConsumerTransport messaging integration', () => {
  const suffix = randomUUID().replaceAll('-', '');
  const names = {
    domainExchange: `foc.events.test.${suffix}`,
    mainQueue: `credit-service.user-registered.v1.test.${suffix}`,
    retryExchange: `foc.credit.retry.test.${suffix}`,
    retryReturnExchange: `foc.credit.back.test.${suffix}`,
    deadLetterExchange: `foc.credit.dlx.test.${suffix}`,
    deadLetterQueue: `credit-service.user-registered.v1.dlq.test.${suffix}`,
    secondQueue: `credit-service.credit-reservation.v1.test.${suffix}`,
    secondDeadLetterQueue: `credit-service.credit-reservation.v1.dlq.test.${suffix}`,
    siblingQueue: `credit-service.user-registered-audit.v1.test.${suffix}`,
    siblingDeadLetterQueue: `credit-service.user-registered-audit.v1.dlq.test.${suffix}`,
  };
  const rabbitMqUrl = process.env.RABBITMQ_URL;
  let behavior: (
    message: IncomingDomainMessage,
  ) => Promise<MessageHandlingResult>;
  const handler: RabbitMqMessageHandler = {
    handle: vi.fn((message) => behavior(message)),
  };
  const secondHandler: RabbitMqMessageHandler = {
    handle: vi.fn().mockResolvedValue({ outcome: 'ack' }),
  };
  const siblingHandler: RabbitMqMessageHandler = {
    handle: vi.fn().mockResolvedValue({ outcome: 'ack' }),
  };
  let connection: ChannelModel;
  let adminChannel: Channel;
  let publisherChannel: ConfirmChannel;
  let transport: RabbitMqConsumerTransport;

  beforeAll(async () => {
    if (!rabbitMqUrl) {
      throw new Error(
        'RABBITMQ_URL is required; create credit-service/.env before running messaging tests',
      );
    }

    const values = {
      RABBITMQ_EXCHANGE: names.domainExchange,
      RABBITMQ_USER_REGISTERED_QUEUE: names.mainQueue,
      RABBITMQ_USER_REGISTERED_ROUTING_KEY: 'user.registered.v1',
      RABBITMQ_RETRY_EXCHANGE: names.retryExchange,
      RABBITMQ_RETRY_RETURN_EXCHANGE: names.retryReturnExchange,
      RABBITMQ_DEAD_LETTER_EXCHANGE: names.deadLetterExchange,
      RABBITMQ_PREFETCH: 1,
      RABBITMQ_RETRY_DELAYS_MS: RETRY_DELAYS,
    } as Partial<EnvironmentVariables>;
    const config = {
      getOrThrow: (key: keyof EnvironmentVariables) => {
        const value = values[key];
        if (value === undefined) {
          throw new Error(`Missing test configuration: ${key}`);
        }
        return value;
      },
    } as ConfigService<EnvironmentVariables, true>;

    connection = await connect(rabbitMqUrl);
    adminChannel = await connection.createChannel();
    publisherChannel = await connection.createConfirmChannel();
    await adminChannel.assertExchange(names.domainExchange, 'direct', {
      durable: true,
    });
    behavior = async () => ({ outcome: 'ack' });
    transport = new RabbitMqConsumerTransport(config, rabbitMqUrl, connect);
    await transport.subscribe({
      queue: names.mainQueue,
      routingKey: 'user.registered.v1',
      deadLetterQueue: names.deadLetterQueue,
      handler,
    });
    await transport.subscribe({
      queue: names.secondQueue,
      routingKey: 'credit.reservation.v1',
      deadLetterQueue: names.secondDeadLetterQueue,
      handler: secondHandler,
    });
  });

  beforeEach(async () => {
    vi.mocked(handler.handle).mockClear();
    vi.mocked(secondHandler.handle).mockClear();
    behavior = async () => ({ outcome: 'ack' });
    await adminChannel.purgeQueue(names.mainQueue);
    await adminChannel.purgeQueue(names.deadLetterQueue);
    await adminChannel.purgeQueue(names.secondQueue);
    await adminChannel.purgeQueue(names.secondDeadLetterQueue);
    for (const index of RETRY_DELAYS.keys()) {
      await adminChannel.purgeQueue(`${names.mainQueue}.retry.${index + 1}`);
      await adminChannel.purgeQueue(`${names.secondQueue}.retry.${index + 1}`);
    }
  });

  afterAll(async () => {
    await transport?.close();

    if (adminChannel) {
      await adminChannel.deleteQueue(names.mainQueue);
      await adminChannel.deleteQueue(names.deadLetterQueue);
      await adminChannel.deleteQueue(names.secondQueue);
      await adminChannel.deleteQueue(names.secondDeadLetterQueue);
      await adminChannel.deleteQueue(names.siblingQueue);
      await adminChannel.deleteQueue(names.siblingDeadLetterQueue);
      for (const index of RETRY_DELAYS.keys()) {
        await adminChannel.deleteQueue(`${names.mainQueue}.retry.${index + 1}`);
        await adminChannel.deleteQueue(
          `${names.secondQueue}.retry.${index + 1}`,
        );
        await adminChannel.deleteQueue(
          `${names.siblingQueue}.retry.${index + 1}`,
        );
      }
      await adminChannel.deleteExchange(names.retryExchange);
      await adminChannel.deleteExchange(names.retryReturnExchange);
      await adminChannel.deleteExchange(names.deadLetterExchange);
      await adminChannel.deleteExchange(names.domainExchange);
    }

    await publisherChannel?.close();
    await adminChannel?.close();
    await connection?.close();
  });

  function eventBody(): Buffer {
    return Buffer.from(
      JSON.stringify({
        eventId: '19860606-e57b-4e8d-baa9-7f5b11293f41',
        eventType: 'UserRegistered',
        timestamp: '2026-09-22T08:30:00.000Z',
        publisher: 'user-service',
        payload: {
          userId: 'db3f2ca7-1f10-4fd3-965d-a721d26ba80b',
          email: 'student@u.nus.edu',
          displayName: 'Student One',
        },
      }),
    );
  }

  async function publish(
    body = eventBody(),
    routingKey = 'user.registered.v1',
  ): Promise<void> {
    await confirmedPublish(
      publisherChannel,
      names.domainExchange,
      routingKey,
      body,
    );
  }

  async function takeDeadLetter(): Promise<GetMessage> {
    return waitFor(async () => {
      const delivery = await adminChannel.get(names.deadLetterQueue, {
        noAck: true,
      });
      return delivery || undefined;
    });
  }

  async function takeSecondDeadLetter(): Promise<GetMessage> {
    return waitFor(async () => {
      const delivery = await adminChannel.get(names.secondDeadLetterQueue, {
        noAck: true,
      });
      return delivery || undefined;
    });
  }

  it('isolates delivery and permanent failure handling between streams', async () => {
    vi.mocked(secondHandler.handle).mockResolvedValueOnce({
      outcome: 'dead-letter',
      category: 'INVALID_PAYLOAD',
      reason: 'invalid reservation',
    });
    const original = Buffer.from(
      JSON.stringify({
        eventId: randomUUID(),
        eventType: 'CreditReservation',
      }),
    );

    await publish(original, 'credit.reservation.v1');
    const deadLetter = await takeSecondDeadLetter();

    expect(deadLetter.content.equals(original)).toBe(true);
    expect(secondHandler.handle).toHaveBeenCalledOnce();
    expect(handler.handle).not.toHaveBeenCalled();
    expect(
      (await adminChannel.checkQueue(names.deadLetterQueue)).messageCount,
    ).toBe(0);
  });

  it('does not deliver a routing key without an exact binding', async () => {
    await publish(eventBody(), 'user.profile-updated.v1');

    // Publisher confirmation means RabbitMQ has completed routing before these
    // assertions; the direct exchange has no matching destination.
    expect(handler.handle).not.toHaveBeenCalled();
    expect(secondHandler.handle).not.toHaveBeenCalled();
    expect((await adminChannel.checkQueue(names.mainQueue)).messageCount).toBe(
      0,
    );
    expect(
      (await adminChannel.checkQueue(names.secondQueue)).messageCount,
    ).toBe(0);
  });

  it('returns transient retries only to their originating stream', async () => {
    vi.mocked(secondHandler.handle)
      .mockRejectedValueOnce(new Error('temporary reservation failure'))
      .mockResolvedValueOnce({ outcome: 'ack' });

    await publish(
      Buffer.from(
        JSON.stringify({
          eventId: randomUUID(),
          eventType: 'CreditReservation',
        }),
      ),
      'credit.reservation.v1',
    );

    await waitFor(() =>
      vi.mocked(secondHandler.handle).mock.calls.length === 2
        ? true
        : undefined,
    );
    expect(handler.handle).not.toHaveBeenCalled();
    for (const index of RETRY_DELAYS.keys()) {
      expect(
        (await adminChannel.checkQueue(`${names.mainQueue}.retry.${index + 1}`))
          .messageCount,
      ).toBe(0);
    }
  });

  it('delivers and manually acknowledges a successful message', async () => {
    await publish();

    await waitFor(() =>
      vi.mocked(handler.handle).mock.calls.length === 1 ? true : undefined,
    );
    const queue = await adminChannel.checkQueue(names.mainQueue);

    expect(queue.messageCount).toBe(0);
    expect(handler.handle).toHaveBeenCalledWith(
      expect.objectContaining({
        routingKey: 'user.registered.v1',
        retryCount: 0,
        eventId: '19860606-e57b-4e8d-baa9-7f5b11293f41',
      }),
    );
  });

  it('redelivers a transient failure through the first retry queue', async () => {
    let attempt = 0;
    behavior = async () => {
      attempt += 1;
      if (attempt === 1) {
        throw new Error('temporary failure');
      }
      return { outcome: 'ack' };
    };

    await publish();

    await waitFor(() =>
      vi.mocked(handler.handle).mock.calls.length === 2 ? true : undefined,
    );
    expect(handler.handle).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ retryCount: 1 }),
    );
  });

  it('dead-letters an explicit permanent failure without retrying', async () => {
    behavior = async () => ({
      outcome: 'dead-letter',
      category: 'INVALID_PAYLOAD',
      reason: 'payload does not match UserRegistered v1',
    });
    const original = eventBody();

    await publish(original);
    const deadLetter = await takeDeadLetter();

    expect(deadLetter.content.equals(original)).toBe(true);
    expect(deadLetter.properties.deliveryMode).toBe(2);
    expect(deadLetter.properties.headers).toMatchObject({
      'x-retry-count': 0,
      'x-event-id': '19860606-e57b-4e8d-baa9-7f5b11293f41',
      'x-failure-category': 'INVALID_PAYLOAD',
      'x-failure-reason': 'payload does not match UserRegistered v1',
    });
    expect(handler.handle).toHaveBeenCalledTimes(1);
  });

  it('dead-letters malformed JSON without calling the handler', async () => {
    const original = Buffer.from('{invalid-json');

    await publish(original);
    const deadLetter = await takeDeadLetter();

    expect(deadLetter.content.equals(original)).toBe(true);
    expect(deadLetter.properties.headers).toMatchObject({
      'x-failure-category': 'MALFORMED_JSON',
    });
    expect(handler.handle).not.toHaveBeenCalled();
  });

  it('dead-letters a transient failure after five retries', async () => {
    behavior = async () => {
      throw new Error('dependency unavailable');
    };

    await publish();
    const deadLetter = await takeDeadLetter();

    expect(handler.handle).toHaveBeenCalledTimes(6);
    expect(deadLetter.properties.headers).toMatchObject({
      'x-retry-count': 5,
      'x-failure-category': 'PROCESSING_RETRIES_EXHAUSTED',
    });
  });

  it('returns a retry only to the failed queue when queues share a domain key', async () => {
    await transport.subscribe({
      queue: names.siblingQueue,
      routingKey: 'user.registered.v1',
      deadLetterQueue: names.siblingDeadLetterQueue,
      handler: siblingHandler,
    });
    let attempt = 0;
    behavior = async () => {
      attempt += 1;
      if (attempt === 1) {
        throw new Error('temporary primary-stream failure');
      }
      return { outcome: 'ack' };
    };

    await publish();

    await waitFor(() =>
      vi.mocked(handler.handle).mock.calls.length === 2 &&
      vi.mocked(siblingHandler.handle).mock.calls.length === 1
        ? true
        : undefined,
    );
    // Both queues receive the original exactly-bound event, but queue-identity
    // return route prevents the successful sibling from seeing the retry.
    expect(handler.handle).toHaveBeenCalledTimes(2);
    expect(siblingHandler.handle).toHaveBeenCalledTimes(1);
    expect(handler.handle).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        routingKey: 'user.registered.v1',
        retryCount: 1,
      }),
    );
  });

  it('removes every consumer during graceful shutdown', async () => {
    await transport.close();

    const firstQueue = await adminChannel.checkQueue(names.mainQueue);
    const secondQueue = await adminChannel.checkQueue(names.secondQueue);
    const siblingQueue = await adminChannel.checkQueue(names.siblingQueue);
    expect(firstQueue.consumerCount).toBe(0);
    expect(secondQueue.consumerCount).toBe(0);
    expect(siblingQueue.consumerCount).toBe(0);
  });
});
