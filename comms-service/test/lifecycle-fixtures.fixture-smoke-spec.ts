import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AccountEventContractValidator } from '@foc/contracts';
import type { Channel, GetMessage } from 'amqplib';
import { DataSource } from 'typeorm';
import { createDatabaseOptions } from '../src/database/database-options.js';
import { LifecycleConsumerLifecycle } from '../src/lifecycle/lifecycle-consumer.lifecycle.js';
import { LifecycleFactQueryService } from '../src/lifecycle/lifecycle-fact-query.service.js';
import { LifecycleIngestionService } from '../src/lifecycle/lifecycle-ingestion.service.js';
import { LifecycleMessageDispatcher } from '../src/lifecycle/lifecycle-message.handler.js';
import { RabbitMqConnectionService } from '../src/messaging/rabbitmq-connection.service.js';
import { createRabbitMqConnectionUrl } from '../src/messaging/rabbitmq-connection-url.provider.js';
import { RabbitMqConsumerTransport } from '../src/messaging/rabbitmq-consumer.transport.js';
import { RabbitMqTopologyService } from '../src/messaging/rabbitmq-topology.service.js';
import { publishFixture } from '../scripts/lifecycle-fixture-publisher.mjs';

const EVENTS_QUEUE = 'comms-service.events';
const EVENTS_DLQ = `${EVENTS_QUEUE}.dlq`;

async function fixture(name: string): Promise<Buffer> {
  return readFile(resolve(process.cwd(), 'test', 'fixtures', name));
}

async function waitFor<T>(
  probe: () => Promise<T | undefined>,
  timeoutMs = 8_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await probe();
    if (result !== undefined) return result;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error(`Condition was not met within ${timeoutMs}ms`);
}

describe('lifecycle fixtures through RabbitMQ and PostgreSQL', () => {
  let dataSource: DataSource;
  let connection: RabbitMqConnectionService;
  let transport: RabbitMqConsumerTransport;
  let inspectionChannel: Channel;
  const fixtureUrl = process.env.RABBITMQ_FIXTURE_URL;

  async function publish(name: string, routingKey: string): Promise<void> {
    await publishFixture({
      url: fixtureUrl,
      routingKey,
      body: await fixture(name),
    });
  }

  async function counts(): Promise<{
    inbox: number;
    facts: number;
    chats: number;
  }> {
    const [row] = await dataSource.query<
      Array<{ inbox: string; facts: string; chats: string }>
    >(`SELECT
         (SELECT count(*) FROM inbox_events)::text AS inbox,
         (SELECT count(*) FROM chat_lifecycle_events)::text AS facts,
         (SELECT count(*) FROM chats)::text AS chats`);
    return {
      inbox: Number(row.inbox),
      facts: Number(row.facts),
      chats: Number(row.chats),
    };
  }

  async function waitForExactCounts(expected: {
    inbox: number;
    facts: number;
    chats: number;
  }): Promise<typeof expected> {
    return waitFor(async () => {
      const actual = await counts();
      return JSON.stringify(actual) === JSON.stringify(expected)
        ? actual
        : undefined;
    });
  }

  async function takeDeadLetter(): Promise<GetMessage> {
    return waitFor(async () => {
      const message = await inspectionChannel.get(EVENTS_DLQ, {
        noAck: true,
      });
      return message || undefined;
    });
  }

  beforeAll(async () => {
    if (
      process.env.NODE_ENV !== 'test' ||
      !process.env.DB_DATABASE?.endsWith('_test')
    ) {
      throw new Error(
        'Fixture smoke tests require a disposable *_test database',
      );
    }
    if (!fixtureUrl) throw new Error('RABBITMQ_FIXTURE_URL is required');

    dataSource = new DataSource(
      createDatabaseOptions({
        DB_HOST: process.env.DB_HOST!,
        DB_PORT: Number(process.env.DB_PORT),
        DB_USERNAME: process.env.DB_USERNAME!,
        DB_DATABASE: process.env.DB_DATABASE,
        DB_PASSWORD_FILE: process.env.DB_PASSWORD_FILE!,
      }),
    );
    await dataSource.initialize();
    await dataSource.dropDatabase();
    await dataSource.runMigrations({ transaction: 'all' });

    const commsUrl = createRabbitMqConnectionUrl({
      RABBITMQ_USER: process.env.RABBITMQ_USER!,
      RABBITMQ_HOST: process.env.RABBITMQ_HOST!,
      RABBITMQ_PORT: Number(process.env.RABBITMQ_PORT),
      RABBITMQ_VHOST: process.env.RABBITMQ_VHOST!,
      RABBITMQ_PASSWORD_FILE: process.env.RABBITMQ_PASSWORD_FILE!,
    });
    connection = new RabbitMqConnectionService(commsUrl);
    await connection.onModuleInit();
    await new RabbitMqTopologyService(connection).provision();
    inspectionChannel = await connection.createChannel();
    transport = new RabbitMqConsumerTransport(connection);

    // Prove the service-owned pub/sub queue retains events before a consumer
    // starts. Two copies also exercise concurrent event-ID deduplication.
    await publish('errand-accepted.v1.json', 'order.errand-accepted.v1');
    await publish('errand-accepted.v1.json', 'order.errand-accepted.v1');

    const dispatcher = new LifecycleMessageDispatcher(
      new AccountEventContractValidator(),
      new LifecycleIngestionService(
        dataSource,
        new LifecycleFactQueryService(dataSource),
      ),
    );
    await new LifecycleConsumerLifecycle(
      transport,
      dispatcher,
    ).onApplicationBootstrap();
  });

  afterAll(async () => {
    await transport?.close();
    await inspectionChannel?.close().catch(() => undefined);
    await connection?.onApplicationShutdown();
    if (dataSource?.isInitialized) {
      await dataSource.undoLastMigration({ transaction: 'all' });
      await dataSource.destroy();
    }
  });

  it('creates chats idempotently and isolates invalid evidence', async () => {
    await waitForExactCounts({ inbox: 1, facts: 1, chats: 1 });
    await waitFor(async () => {
      const queue = await inspectionChannel.checkQueue(EVENTS_QUEUE);
      return queue.messageCount === 0 ? true : undefined;
    });
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    expect(await counts()).toEqual({ inbox: 1, facts: 1, chats: 1 });

    const [created] = await dataSource.query<
      Array<{
        acceptance_event_id: string;
        errand_id: string;
        requester_user_id: string;
        courier_user_id: string;
        state: string;
        next_sequence: string;
        closes_at: Date | null;
        close_reason: string | null;
        archive_id: string | null;
      }>
    >('SELECT * FROM chats WHERE acceptance_event_id = $1', [
      '10000000-0000-4000-8000-000000000001',
    ]);
    expect(created).toMatchObject({
      errand_id: '20000000-0000-4000-8000-000000000001',
      requester_user_id: '30000000-0000-4000-8000-000000000001',
      courier_user_id: '40000000-0000-4000-8000-000000000001',
      state: 'ACTIVE',
      next_sequence: '1',
      closes_at: null,
      close_reason: null,
      archive_id: null,
    });

    await publish('errand-reaccepted.v1.json', 'order.errand-accepted.v1');
    await waitForExactCounts({ inbox: 2, facts: 2, chats: 2 });
    const reacceptedChats = await dataSource.query<
      Array<{ acceptance_event_id: string; courier_user_id: string }>
    >(
      `SELECT acceptance_event_id, courier_user_id
         FROM chats
        WHERE errand_id = $1
        ORDER BY accepted_at`,
      ['20000000-0000-4000-8000-000000000001'],
    );
    expect(reacceptedChats).toEqual([
      {
        acceptance_event_id: '10000000-0000-4000-8000-000000000001',
        courier_user_id: '40000000-0000-4000-8000-000000000001',
      },
      {
        acceptance_event_id: '10000000-0000-4000-8000-000000000002',
        courier_user_id: '50000000-0000-4000-8000-000000000001',
      },
    ]);

    await Promise.all([
      publish('errand-delivered.v1.json', 'order.errand-delivered.v1'),
      publish('courier-cancelled.v1.json', 'order.courier-cancelled.v1'),
      publish('errand-cancelled.v1.json', 'order.errand-cancelled.v1'),
    ]);
    await waitForExactCounts({ inbox: 5, facts: 5, chats: 2 });
    const terminalKinds = await dataSource.query<Array<{ kind: string }>>(
      `SELECT kind FROM chat_lifecycle_events
        WHERE kind <> 'ERRAND_ACCEPTED'
        ORDER BY kind`,
    );
    expect(terminalKinds.map(({ kind }) => kind)).toEqual([
      'COURIER_CANCELLED',
      'ERRAND_CANCELLED',
      'ERRAND_DELIVERED',
    ]);

    await publish(
      'errand-accepted-unknown-field.invalid.v1.json',
      'order.errand-accepted.v1',
    );
    expect((await takeDeadLetter()).properties.headers).toMatchObject({
      'x-failure-category': 'INVALID_PAYLOAD',
      'x-comms-original-routing-key': 'order.errand-accepted.v1',
    });
    expect(await counts()).toEqual({ inbox: 5, facts: 5, chats: 2 });

    await publish(
      'errand-accepted-wrong-publisher.invalid.v1.json',
      'order.errand-accepted.v1',
    );
    expect((await takeDeadLetter()).properties.headers).toMatchObject({
      'x-failure-category': 'INVALID_ENVELOPE',
      'x-comms-original-routing-key': 'order.errand-accepted.v1',
    });

    await publish(
      'errand-accepted-conflict.v1.json',
      'order.errand-accepted.v1',
    );
    expect((await takeDeadLetter()).properties.headers).toMatchObject({
      'x-failure-category': 'IDENTITY_CONFLICT',
      'x-comms-original-routing-key': 'order.errand-accepted.v1',
    });
    expect(await counts()).toEqual({ inbox: 5, facts: 5, chats: 2 });
    const [preserved] = await dataSource.query<
      Array<{ timestamp: string; courier_user_id: string }>
    >(
      `SELECT fact.envelope->>'timestamp' AS timestamp, chat.courier_user_id
         FROM chat_lifecycle_events fact
         JOIN chats chat ON chat.acceptance_event_id = fact.source_event_id
        WHERE fact.source_event_id = $1`,
      ['10000000-0000-4000-8000-000000000001'],
    );
    expect(preserved).toEqual({
      timestamp: '2026-11-04T01:00:00.000Z',
      courier_user_id: '40000000-0000-4000-8000-000000000001',
    });
  });
});
