import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { AccountEventContractValidator } from '@foc/contracts';
import { OutboxRelay, OutboxStore, RabbitMqOutboxPublisher } from '@foc/outbox';
import type { ConfigService } from '@nestjs/config';
import {
  type Channel,
  type ChannelModel,
  connect,
  type GetMessage,
} from 'amqplib';
import { DataSource } from 'typeorm';
import { BuildingsService } from '../src/buildings/buildings.service.js';
import { CategoriesService } from '../src/categories/categories.service.js';
import type { EnvironmentVariables } from '../src/config/environment.schema.js';
import { createDatabaseOptions } from '../src/database/database-options.js';
import {
  Building,
  BuildingNameKey,
  Category,
  SupplierKind,
} from '../src/database/entities/index.js';
import type { AmqpConnect } from '../src/messaging/amqp-connection.provider.js';
import { RabbitMqConsumerTransport } from '../src/messaging/rabbitmq-consumer.transport.js';
import { SupplierQueriesService } from '../src/suppliers/supplier-queries.service.js';
import { SuppliersService } from '../src/suppliers/suppliers.service.js';
import { SupplierValidationMessageHandler } from '../src/validation/supplier-validation-message.handler.js';
import { SupplierValidationService } from '../src/validation/supplier-validation.service.js';

const EXCHANGE = 'foc.events';
const QUESTION_KEY = 'order.supplier-validation-requested.v1';
const ANSWER_KEY = 'supplier.validation-completed.v1';
const QUEUE = 'supplier-service.order-supplier-validation-requested.v1';
const DEAD_LETTERS = `${QUEUE}.dlq`;
// Stands in for Order Service's reply queue from rabbitmq/definitions.json.
const REPLIES = 'test.order-service.supplier-validation-completed.v1';

const VALUES: Record<string, unknown> = {
  CAMPUS_MIN_LATITUDE: 1.28,
  CAMPUS_MAX_LATITUDE: 1.31,
  CAMPUS_MIN_LONGITUDE: 103.74,
  CAMPUS_MAX_LONGITUDE: 103.79,
  PLACEHOLDER_IMAGE_URL: '',
  RABBITMQ_EXCHANGE: EXCHANGE,
  RABBITMQ_RETRY_EXCHANGE: 'foc.supplier.retry',
  RABBITMQ_RETRY_RETURN_EXCHANGE: 'foc.supplier.back',
  RABBITMQ_DEAD_LETTER_EXCHANGE: 'foc.supplier.dlx',
  RABBITMQ_PREFETCH: 10,
  RABBITMQ_RETRY_DELAYS_MS: [100, 200, 300, 400, 500],
  RABBITMQ_SUPPLIER_VALIDATION_COMPLETED_ROUTING_KEY: ANSWER_KEY,
  OUTBOX_POLL_INTERVAL_MS: 100,
  OUTBOX_BATCH_SIZE: 10,
  OUTBOX_CONFIRM_TIMEOUT_MS: 5_000,
  OUTBOX_CLAIM_LEASE_MS: 30_000,
  OUTBOX_RETRY_BASE_DELAY_MS: 100,
  OUTBOX_RETRY_MAX_DELAY_MS: 1_000,
  OUTBOX_UNPUBLISHED_WARNING_MS: 60_000,
};
const config = {
  get: (key: string) => VALUES[key],
  getOrThrow: (key: string) => {
    if (!(key in VALUES)) throw new Error(`missing test setting ${key}`);
    return VALUES[key];
  },
} as unknown as ConfigService<EnvironmentVariables, true>;

/** Polls a queue until a message arrives or the timeout passes. */
async function nextMessage(
  channel: Channel,
  queue: string,
  timeoutMs = 10_000,
): Promise<GetMessage | false> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const message = await channel.get(queue, { noAck: true });
    if (message !== false) return message;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

const question = (supplierId: string, eventId = randomUUID()) => ({
  eventId,
  eventType: 'SupplierValidationRequested',
  timestamp: new Date().toISOString(),
  publisher: 'order-service',
  payload: { errandId: randomUUID(), supplierId },
});

describe('supplier validation through a real broker (F15.7)', () => {
  const rabbitMqUrl = process.env.RABBITMQ_TEST_URL!;
  let dataSource: DataSource;
  let connection: ChannelModel;
  let channel: Channel;
  let transport: RabbitMqConsumerTransport;
  let publisher: RabbitMqOutboxPublisher;
  let relay: OutboxRelay;
  let supplierId: string;

  beforeAll(async () => {
    dataSource = new DataSource(
      createDatabaseOptions({
        DB_HOST: process.env.DB_HOST!,
        DB_PORT: Number(process.env.DB_PORT),
        DB_USERNAME: process.env.DB_USERNAME!,
        DB_DATABASE: process.env.DB_DATABASE!,
        DB_PASSWORD_FILE: process.env.DB_PASSWORD_FILE!,
        DB_MIGRATIONS_RUN: false,
      }),
    );
    await dataSource.initialize();
    await dataSource.dropDatabase();
    await dataSource.runMigrations({ transaction: 'all' });

    const building = await new BuildingsService(
      dataSource,
      dataSource.getRepository(Building),
      dataSource.getRepository(BuildingNameKey),
    ).create({
      canonicalName: 'Computing 2',
      shortName: 'COM2',
      aliases: [],
      latitude: 1.2939,
      longitude: 103.7742,
    });
    const food = await new CategoriesService(
      dataSource.getRepository(Category),
    ).create('Food');
    ({ id: supplierId } = await new SuppliersService(dataSource, config).create(
      {
        name: 'Cool Spot',
        kind: SupplierKind.Store,
        categoryIds: [food.id],
        buildingId: building.id,
        floor: '1',
        locationDescription: 'Next to LT19',
        coordinates: { latitude: 1.294, longitude: 103.7738 },
      },
    ));

    // What rabbitmq/definitions.json provides in the real stack: the shared
    // exchange, and Order Service's reply queue.
    connection = await connect(rabbitMqUrl);
    channel = await connection.createChannel();
    await channel.assertExchange(EXCHANGE, 'direct', { durable: true });
    await channel.assertQueue(REPLIES, {
      durable: false,
      exclusive: true,
      autoDelete: true,
    });
    await channel.bindQueue(REPLIES, EXCHANGE, ANSWER_KEY);

    const contracts = new AccountEventContractValidator();
    const handler = new SupplierValidationMessageHandler(
      contracts,
      new SupplierValidationService(
        dataSource,
        new SupplierQueriesService(dataSource, config),
        contracts,
        config,
      ),
    );
    transport = new RabbitMqConsumerTransport(
      config,
      rabbitMqUrl,
      connect as unknown as AmqpConnect,
    );
    await transport.subscribe({
      queue: QUEUE,
      routingKey: QUESTION_KEY,
      handler,
    });
    await channel.purgeQueue(DEAD_LETTERS);

    publisher = new RabbitMqOutboxPublisher(
      config,
      { exchange: EXCHANGE, appId: 'supplier-service', rabbitMqUrl },
      connect,
    );
    // The relay starts its publisher, then publishes committed outbox rows.
    relay = new OutboxRelay(config, new OutboxStore(dataSource), publisher);
    await relay.start();
  });

  afterAll(async () => {
    // Closing the relay also closes its publisher.
    await relay?.close();
    await transport?.close();
    await channel?.deleteQueue(REPLIES).catch(() => undefined);
    await channel?.close().catch(() => undefined);
    await connection?.close().catch(() => undefined);
    await dataSource?.destroy();
  });

  const ask = (body: unknown) =>
    channel.publish(EXCHANGE, QUESTION_KEY, Buffer.from(JSON.stringify(body)), {
      contentType: 'application/json',
      persistent: true,
      messageId: (body as { eventId?: string }).eventId,
    });

  it('answers a question with exactly one FOUND reply carrying the snapshot (F15.7.2)', async () => {
    const asked = question(supplierId);
    ask(asked);

    const reply = await nextMessage(channel, REPLIES);
    expect(reply).not.toBe(false);
    const answer = JSON.parse((reply as GetMessage).content.toString('utf8'));
    expect(answer).toMatchObject({
      eventType: 'SupplierValidationCompleted',
      publisher: 'supplier-service',
      payload: {
        errandId: asked.payload.errandId,
        supplierId,
        outcome: 'FOUND',
        supplier: {
          status: 'Active',
          version: 1,
          displayName: 'Cool Spot @ COM2',
        },
      },
    });
    expect(await nextMessage(channel, REPLIES, 1_500)).toBe(false);
  });

  it('answers a redelivered question only once (F15.7.4)', async () => {
    const asked = question(supplierId);
    ask(asked);
    ask(structuredClone(asked));

    expect(await nextMessage(channel, REPLIES)).not.toBe(false);
    expect(await nextMessage(channel, REPLIES, 2_000)).toBe(false);
  });

  it('dead-letters a malformed question, without a retry or a reply (F15.7.6)', async () => {
    const malformed = question(supplierId) as Record<string, unknown>;
    (malformed.payload as Record<string, unknown>).supplierId = 'not-a-uuid';
    ask(malformed);

    const deadLetter = await nextMessage(channel, DEAD_LETTERS);
    expect(deadLetter).not.toBe(false);
    expect(
      JSON.parse((deadLetter as GetMessage).content.toString('utf8')),
    ).toMatchObject({ eventId: malformed.eventId });
    expect(await nextMessage(channel, REPLIES, 1_500)).toBe(false);
  });
});
