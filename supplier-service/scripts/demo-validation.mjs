// D3 demo: Supplier Service answering Order Service's supplier-validation
// questions through a real RabbitMQ (F15.7). Self-contained: it runs the
// service's real consumer, handler, outbox and relay against the throwaway
// test broker and test database, playing Order Service's part itself.
//
//   npm run db:test:up && npm run broker:test:up && npm run demo:validation
//
// Watch the queues at http://localhost:15677 (supplier_service_test /
// supplier_service_test). The test database is wiped and re-created.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { AccountEventContractValidator } from '@foc/contracts';
import { OutboxRelay, OutboxStore, RabbitMqOutboxPublisher } from '@foc/outbox';
import { connect } from 'amqplib';
import { DataSource } from 'typeorm';
import { BuildingsService } from '../dist/buildings/buildings.service.js';
import { CategoriesService } from '../dist/categories/categories.service.js';
import { createDatabaseOptions } from '../dist/database/database-options.js';
import {
  Building,
  BuildingNameKey,
  Category,
  SupplierKind,
  SupplierStatus,
} from '../dist/database/entities/index.js';
import { RabbitMqConsumerTransport } from '../dist/messaging/rabbitmq-consumer.transport.js';
import { SupplierQueriesService } from '../dist/suppliers/supplier-queries.service.js';
import { SuppliersService } from '../dist/suppliers/suppliers.service.js';
import { SupplierValidationMessageHandler } from '../dist/validation/supplier-validation-message.handler.js';
import { SupplierValidationService } from '../dist/validation/supplier-validation.service.js';

const brokerPort = process.env.SUPPLIER_RABBITMQ_TEST_HOST_PORT ?? '5677';
const rabbitMqUrl = `amqp://supplier_service_test:supplier_service_test@127.0.0.1:${brokerPort}`;
const EXCHANGE = 'foc.events';
const QUESTION_KEY = 'order.supplier-validation-requested.v1';
const ANSWER_KEY = 'supplier.validation-completed.v1';
const QUEUE = 'supplier-service.order-supplier-validation-requested.v1';
const DEAD_LETTERS = `${QUEUE}.dlq`;
const REPLIES = 'demo.order-service.supplier-validation-completed.v1';

const VALUES = {
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
  RABBITMQ_RETRY_DELAYS_MS: [1000, 2000, 4000, 8000, 16000],
  RABBITMQ_SUPPLIER_VALIDATION_COMPLETED_ROUTING_KEY: ANSWER_KEY,
  OUTBOX_POLL_INTERVAL_MS: 200,
  OUTBOX_BATCH_SIZE: 10,
  OUTBOX_CONFIRM_TIMEOUT_MS: 5000,
  OUTBOX_CLAIM_LEASE_MS: 30000,
  OUTBOX_RETRY_BASE_DELAY_MS: 200,
  OUTBOX_RETRY_MAX_DELAY_MS: 2000,
  OUTBOX_UNPUBLISHED_WARNING_MS: 60000,
};
const config = {
  get: (key) => VALUES[key],
  getOrThrow: (key) => {
    if (!(key in VALUES)) throw new Error(`missing demo setting ${key}`);
    return VALUES[key];
  },
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function nextMessage(channel, queue, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const message = await channel.get(queue, { noAck: true });
    if (message) return JSON.parse(message.content.toString('utf8'));
    await sleep(100);
  }
  return null;
}
const short = (id) => id.slice(0, 8);

const dataSource = new DataSource(
  createDatabaseOptions({
    DB_HOST: '127.0.0.1',
    DB_PORT: Number(process.env.SUPPLIER_DB_TEST_HOST_PORT ?? 5439),
    DB_USERNAME: 'supplier_service',
    DB_DATABASE: 'supplier_service_test',
    DB_PASSWORD_FILE: './secrets/supplier_db_password.secret',
    DB_MIGRATIONS_RUN: false,
  }),
);
await dataSource.initialize();
await dataSource.dropDatabase();
await dataSource.runMigrations({ transaction: 'all' });

const buildings = new BuildingsService(
  dataSource,
  dataSource.getRepository(Building),
  dataSource.getRepository(BuildingNameKey),
);
const com2 = await buildings.create({
  canonicalName: 'Computing 2',
  shortName: 'COM2',
  aliases: [],
  latitude: 1.2939,
  longitude: 103.7742,
});
const food = await new CategoriesService(
  dataSource.getRepository(Category),
).create('Food');
const suppliers = new SuppliersService(dataSource, config);
const supplier = (name, floor) =>
  suppliers.create({
    name,
    kind: SupplierKind.Store,
    categoryIds: [food.id],
    buildingId: com2.id,
    floor,
    locationDescription: 'Next to LT19',
    coordinates: { latitude: 1.294, longitude: 103.7738 },
  });
const active = await supplier('Cool Spot', '1');
const closed = await supplier('Old Kiosk', '2');
await suppliers.changeStatus(closed.id, 1, SupplierStatus.Inactive);

// What rabbitmq/definitions.json provides in the full stack: the shared
// exchange, and (standing in for Order Service) a reply queue.
const connection = await connect(rabbitMqUrl);
const channel = await connection.createChannel();
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
const transport = new RabbitMqConsumerTransport(config, rabbitMqUrl, connect);
await transport.subscribe({ queue: QUEUE, routingKey: QUESTION_KEY, handler });
await channel.purgeQueue(DEAD_LETTERS);
const relay = new OutboxRelay(
  config,
  new OutboxStore(dataSource),
  new RabbitMqOutboxPublisher(
    config,
    { exchange: EXCHANGE, appId: 'supplier-service', rabbitMqUrl },
    connect,
  ),
);
await relay.start();

const question = (supplierId, eventId = randomUUID()) => ({
  eventId,
  eventType: 'SupplierValidationRequested',
  timestamp: new Date().toISOString(),
  publisher: 'order-service',
  payload: { errandId: randomUUID(), supplierId },
});
const ask = (body) =>
  channel.publish(EXCHANGE, QUESTION_KEY, Buffer.from(JSON.stringify(body)), {
    contentType: 'application/json',
    persistent: true,
    messageId: body.eventId,
  });
function describeAnswer(answer) {
  if (!answer) return '(no answer)';
  const { outcome, supplier } = answer.payload;
  return outcome === 'FOUND'
    ? `FOUND: ${supplier.displayName}, ${supplier.status}, version ${supplier.version}, floor ${supplier.floor}`
    : 'NOT_FOUND';
}
async function scene(title, body, { expectAnswer = true } = {}) {
  console.log(`\n${title}`);
  console.log(
    `  → Order Service asks (event ${short(body.eventId)}): is supplier ${short(String(body.payload.supplierId))} OK?`,
  );
  ask(body);
  if (expectAnswer) {
    console.log(
      `  ← Supplier Service answers: ${describeAnswer(await nextMessage(channel, REPLIES))}`,
    );
  }
}

console.log('Supplier validation over RabbitMQ (F15.7)');
console.log('=========================================');
await scene('1. An Active supplier', question(active.id));
await scene(
  '2. An Inactive supplier (Order Service decides what that means)',
  question(closed.id),
);
await scene('3. A supplier that does not exist', question(randomUUID()));

const repeated = question(active.id);
await scene('4. The same question delivered twice', repeated);
ask(structuredClone(repeated));
const second = await nextMessage(channel, REPLIES, 2500);
console.log(
  `  → the same event ${short(repeated.eventId)} again... ${second ? 'answered AGAIN (unexpected)' : 'no second answer: it was already in the inbox'}`,
);

const malformed = question(active.id);
malformed.payload.supplierId = 'not-a-uuid';
await scene('5. A malformed question', malformed, { expectAnswer: false });
const deadLetter = await nextMessage(channel, DEAD_LETTERS);
console.log(
  `  ✗ ${deadLetter ? `moved to the dead-letter queue ${DEAD_LETTERS}, no answer, no retry` : 'not dead-lettered (unexpected)'}`,
);

await relay.close();
await transport.close();
await channel.close();
await connection.close();
await dataSource.destroy();
console.log('\nDone.');
