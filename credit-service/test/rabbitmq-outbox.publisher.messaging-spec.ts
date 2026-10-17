import { randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { connect, type Channel, type ChannelModel } from 'amqplib';
import 'dotenv/config';
import type { EnvironmentVariables } from '../src/config/environment.js';
import { RabbitMqOutboxPublisher } from '@foc/outbox';
import { buildRabbitMqTestUrl } from './support/rabbitmq-test-environment.js';

describe('RabbitMqOutboxPublisher messaging integration', () => {
  const suffix = randomUUID().replaceAll('-', '');
  const exchange = `foc.events.outbox.test.${suffix}`;
  const queue = `credit-service.outbox.test.${suffix}`;
  const routingKey = 'credit.reservation-success.v1';
  const rabbitMqUrl = buildRabbitMqTestUrl();
  let connection: ChannelModel;
  let channel: Channel;
  let publisher: RabbitMqOutboxPublisher;

  beforeAll(async () => {
    const values = {
      RABBITMQ_EXCHANGE: exchange,
      OUTBOX_CONFIRM_TIMEOUT_MS: 5_000,
    };
    const config = {
      getOrThrow: (key: keyof typeof values) => values[key],
    } as ConfigService<EnvironmentVariables, true>;
    connection = await connect(rabbitMqUrl);
    channel = await connection.createChannel();
    await channel.assertExchange(exchange, 'direct', { durable: true });
    await channel.assertQueue(queue, {
      durable: false,
      exclusive: true,
      autoDelete: true,
    });
    await channel.bindQueue(queue, exchange, routingKey);
    publisher = new RabbitMqOutboxPublisher(
      config,
      {
        exchange,
        appId: 'credit-service',
        rabbitMqUrl,
      },
      connect,
    );
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
      eventType: 'CreditReservationSuccess',
      timestamp: new Date().toISOString(),
      publisher: 'credit-service',
      payload: {
        errandId: randomUUID(),
        requesterUserId: randomUUID(),
        amount: 100,
        transactionId: randomUUID(),
      },
    };

    await publisher.publish({
      eventId,
      eventType: 'CreditReservationSuccess',
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
      type: 'CreditReservationSuccess',
      appId: 'credit-service',
    });
  });

  it('confirms release-success publication without a subscriber queue', async () => {
    const eventId = randomUUID();
    const envelope = {
      eventId,
      eventType: 'CreditReleaseSuccess',
      timestamp: new Date().toISOString(),
      publisher: 'credit-service',
      payload: {
        errandId: randomUUID(),
        requesterUserId: randomUUID(),
        releasedAmount: 25,
        creditTransactionId: randomUUID(),
      },
    };

    await expect(
      publisher.publish({
        eventId,
        eventType: 'CreditReleaseSuccess',
        routingKey: 'credit.release-success.v1',
        envelope,
      }),
    ).resolves.toBeUndefined();
  });
});
