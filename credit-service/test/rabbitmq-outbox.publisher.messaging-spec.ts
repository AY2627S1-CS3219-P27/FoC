import { randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { connect, type Channel, type ChannelModel } from 'amqplib';
import 'dotenv/config';
import type { EnvironmentVariables } from '../src/config/environment.js';
import { RabbitMqOutboxPublisher } from '../src/outbox/rabbitmq-outbox.publisher.js';

describe('RabbitMqOutboxPublisher messaging integration', () => {
  const suffix = randomUUID().replaceAll('-', '');
  const exchange = `foc.events.outbox.test.${suffix}`;
  const queue = `credit-service.outbox.test.${suffix}`;
  const routingKey = 'credit.account-initialised.v1';
  const rabbitMqUrl = process.env.RABBITMQ_URL;
  let connection: ChannelModel;
  let channel: Channel;
  let publisher: RabbitMqOutboxPublisher;

  beforeAll(async () => {
    if (!rabbitMqUrl) {
      throw new Error(
        'RABBITMQ_URL is required; create credit-service/.env before running messaging tests',
      );
    }

    const values = {
      RABBITMQ_EXCHANGE: exchange,
      OUTBOX_CLAIM_LEASE_MS: 5_000,
    };
    const config = {
      getOrThrow: (key: keyof typeof values) => values[key],
    } as ConfigService<EnvironmentVariables, true>;
    connection = await connect(rabbitMqUrl);
    channel = await connection.createChannel();
    await channel.assertExchange(exchange, 'topic', { durable: true });
    await channel.assertQueue(queue, {
      durable: false,
      exclusive: true,
      autoDelete: true,
    });
    await channel.bindQueue(queue, exchange, routingKey);
    publisher = new RabbitMqOutboxPublisher(config, rabbitMqUrl, connect);
    await publisher.start();
  });

  afterAll(async () => {
    await publisher?.close();
    await channel?.deleteQueue(queue).catch(() => undefined);
    await channel?.deleteExchange(exchange).catch(() => undefined);
    await channel?.close().catch(() => undefined);
    await connection?.close().catch(() => undefined);
  });

  it('publishes the unchanged envelope with persistent identifying properties', async () => {
    const eventId = randomUUID();
    const envelope = {
      eventId,
      eventType: 'CreditAccountInitialised',
      timestamp: new Date().toISOString(),
      publisher: 'credit-service',
      payload: {
        userId: randomUUID(),
        creditAmountAllocated: 100,
        creditAllocationId: randomUUID(),
      },
    };

    await publisher.publish({
      eventId,
      eventType: 'CreditAccountInitialised',
      routingKey,
      envelope,
    });
    const message = await channel.get(queue, { noAck: true });

    expect(message).not.toBe(false);
    if (message === false) {
      throw new Error('Expected the published outbox event');
    }
    expect(JSON.parse(message.content.toString('utf8'))).toEqual(envelope);
    expect(message.fields.exchange).toBe(exchange);
    expect(message.fields.routingKey).toBe(routingKey);
    expect(message.properties).toMatchObject({
      deliveryMode: 2,
      contentType: 'application/json',
      messageId: eventId,
      type: 'CreditAccountInitialised',
      appId: 'credit-service',
    });
  });
});
