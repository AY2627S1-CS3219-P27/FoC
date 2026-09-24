import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import type { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  connect,
  type Channel,
  type ChannelModel,
  type ConfirmChannel,
  type GetMessage,
} from 'amqplib';
import { DataSource } from 'typeorm';
import { AccountInitializationService } from '../src/account-initialization/account-initialization.service.js';
import type {
  ContractValidationResult,
  CreditAccountInitialisedEvent,
  UserRegisteredEvent,
} from '../src/contracts/account-event-contract.types.js';
import { AccountEventContractValidator } from '../src/contracts/account-event-contract.validator.js';
import { createDatabaseOptions } from '../src/database/database-options.js';
import { RABBITMQ_CONNECTION_URL } from '../src/messaging/rabbitmq-connection-url.provider.js';
import { OutboxRelay } from '../src/outbox/outbox.relay.js';

const execFileAsync = promisify(execFile);
const dockerServices = ['credit-db-recovery', 'credit-rabbitmq-recovery'];
const suffix = randomUUID().replaceAll('-', '');
const topology = {
  domainExchange: `foc.events.recovery.${suffix}`,
  incomingQueue: `credit-service.user-registered.recovery.${suffix}`,
  retryExchange: `foc.credit.retry.recovery.${suffix}`,
  retryReturnExchange: `foc.credit.back.recovery.${suffix}`,
  deadLetterExchange: `foc.credit.dlx.recovery.${suffix}`,
  observationQueue: `credit-service.account-initialised.observation.${suffix}`,
};
const incomingRoutingKey = 'user.registered.v1';
const outgoingRoutingKey = 'credit.account-initialised.v1';

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor<T>(
  probe: () => Promise<T | undefined> | T | undefined,
  timeoutMilliseconds = 15_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMilliseconds;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const result = await probe();
      if (result !== undefined) {
        return result;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(50);
  }

  throw new Error(
    `Condition was not met within ${timeoutMilliseconds}ms${lastError instanceof Error ? `: ${lastError.message}` : ''}`,
  );
}

function registration(
  userId: string = randomUUID(),
  eventId: string = randomUUID(),
): UserRegisteredEvent {
  return {
    eventId,
    eventType: 'UserRegistered',
    timestamp: new Date().toISOString(),
    publisher: 'user-service',
    payload: {
      userId,
      email: `${userId}@example.edu`,
      displayName: 'Recovery Student',
    },
  };
}

describe.sequential('account messaging recovery', () => {
  const rabbitMqUrl = process.env.RABBITMQ_URL!;
  const managementUrl = process.env.RABBITMQ_MANAGEMENT_URL!;
  const rabbitUsername = process.env.RABBITMQ_USERNAME ?? 'credit_service';
  const rabbitPassword = process.env.RABBITMQ_PASSWORD!;
  let dataSource: DataSource;
  let app: INestApplication;
  let appModule: Type<unknown>;
  let adminConnection: ChannelModel;
  let adminChannel: Channel;
  let publisherChannel: ConfirmChannel;

  async function runCompose(...args: string[]): Promise<void> {
    await execFileAsync(
      'docker',
      ['compose', '--profile', 'recovery', ...args],
      { cwd: process.cwd(), windowsHide: true },
    );
  }

  async function connectAdmin(): Promise<void> {
    await publisherChannel?.close().catch(() => undefined);
    await adminChannel?.close().catch(() => undefined);
    await adminConnection?.close().catch(() => undefined);

    adminConnection = await waitFor(
      async () => connect(rabbitMqUrl).catch(() => undefined),
      20_000,
    );
    adminChannel = await adminConnection.createChannel();
    publisherChannel = await adminConnection.createConfirmChannel();
    await adminChannel.assertExchange(topology.domainExchange, 'direct', {
      durable: true,
    });
    await adminChannel.assertQueue(topology.observationQueue, {
      durable: true,
    });
    await adminChannel.bindQueue(
      topology.observationQueue,
      topology.domainExchange,
      outgoingRoutingKey,
    );
  }

  async function startApplication(
    disableRelay = false,
  ): Promise<INestApplication> {
    let builder = Test.createTestingModule({ imports: [appModule] })
      .overrideProvider(RABBITMQ_CONNECTION_URL)
      .useValue(rabbitMqUrl);
    if (disableRelay) {
      builder = builder.overrideProvider(OutboxRelay).useValue({
        start: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      });
    }
    const module = await builder.compile();
    const application = module.createNestApplication();
    await application.init();
    return application;
  }

  async function publish(
    body: Buffer,
    routingKey = incomingRoutingKey,
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      publisherChannel.publish(
        topology.domainExchange,
        routingKey,
        body,
        { persistent: true, contentType: 'application/json' },
        (error) => (error ? reject(error) : resolve()),
      );
    });
  }

  async function publishEvent(event: UserRegisteredEvent): Promise<void> {
    await publish(Buffer.from(JSON.stringify(event)));
  }

  async function takeMessage(
    queue: string,
    timeoutMilliseconds = 15_000,
  ): Promise<GetMessage> {
    return waitFor(async () => {
      const message = await adminChannel.get(queue, { noAck: true });
      return message || undefined;
    }, timeoutMilliseconds);
  }

  async function takeOutgoingForUser(
    userId: string,
    timeoutMilliseconds = 15_000,
  ): Promise<{
    message: GetMessage;
    envelope: CreditAccountInitialisedEvent;
  }> {
    const deadline = Date.now() + timeoutMilliseconds;

    // A previous scenario can finish publishing while the next scenario is
    // starting. Match the expected business outcome instead of assuming that
    // the next queue entry belongs to the current test.
    while (Date.now() < deadline) {
      const message = await takeMessage(
        topology.observationQueue,
        Math.max(1, deadline - Date.now()),
      );
      const envelope = JSON.parse(
        message.content.toString('utf8'),
      ) as CreditAccountInitialisedEvent;
      if (envelope.payload.userId === userId) {
        return { message, envelope };
      }
    }

    throw new Error(
      `No CreditAccountInitialised event was observed for user ${userId}`,
    );
  }

  async function userCounts(userId: string): Promise<{
    accounts: number;
    allocations: number;
    inbox: number;
    outbox: number;
  }> {
    const [row] = (await dataSource.query(
      `
        SELECT
          (SELECT COUNT(*)::int FROM credit_accounts WHERE user_id = $1) AS accounts,
          (SELECT COUNT(*)::int FROM credit_allocations WHERE user_id = $1) AS allocations,
          (
            SELECT COUNT(*)::int
            FROM inbox_events inbox
            JOIN credit_allocations allocation
              ON allocation.id = inbox.outcome_allocation_id
            WHERE allocation.user_id = $1
          ) AS inbox,
          (
            SELECT COUNT(*)::int
            FROM outbox_events
            WHERE envelope->'payload'->>'userId' = $1::text
          ) AS outbox
      `,
      [userId],
    )) as Array<{
      accounts: number;
      allocations: number;
      inbox: number;
      outbox: number;
    }>;
    return row;
  }

  async function waitForUserCounts(
    userId: string,
    expected: Awaited<ReturnType<typeof userCounts>>,
  ): Promise<void> {
    await waitFor(async () =>
      JSON.stringify(await userCounts(userId)) === JSON.stringify(expected)
        ? true
        : undefined,
    );
  }

  async function queueMetrics(): Promise<{
    messages_unacknowledged: number;
  }> {
    const response = await fetch(
      `${managementUrl}/api/queues/%2F/${encodeURIComponent(topology.incomingQueue)}`,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(`${rabbitUsername}:${rabbitPassword}`).toString('base64')}`,
        },
      },
    );
    if (!response.ok) {
      throw new Error(`RabbitMQ management API returned ${response.status}`);
    }
    return (await response.json()) as { messages_unacknowledged: number };
  }

  beforeAll(async () => {
    if (!rabbitMqUrl || !managementUrl || !rabbitPassword) {
      throw new Error(
        'Recovery tests must be run through npm run test:recovery',
      );
    }

    Object.assign(process.env, {
      RABBITMQ_EXCHANGE: topology.domainExchange,
      RABBITMQ_USER: 'credit-service-test',
      RABBITMQ_HOST: '127.0.0.1',
      RABBITMQ_PORT: process.env.RABBITMQ_RECOVERY_HOST_PORT ?? '5676',
      RABBITMQ_VHOST: '/',
      RABBITMQ_PASSWORD_FILE: './secrets/credit_db_password.secret',
      RABBITMQ_USER_REGISTERED_QUEUE: topology.incomingQueue,
      RABBITMQ_USER_REGISTERED_ROUTING_KEY: incomingRoutingKey,
      RABBITMQ_CREDIT_ACCOUNT_INITIALISED_ROUTING_KEY: outgoingRoutingKey,
      RABBITMQ_RETRY_EXCHANGE: topology.retryExchange,
      RABBITMQ_RETRY_RETURN_EXCHANGE: topology.retryReturnExchange,
      RABBITMQ_DEAD_LETTER_EXCHANGE: topology.deadLetterExchange,
      RABBITMQ_PREFETCH: '10',
      RABBITMQ_RETRY_DELAYS_MS: '100,200,400,800,1600',
      OUTBOX_POLL_INTERVAL_MS: '200',
      OUTBOX_BATCH_SIZE: '20',
      OUTBOX_CLAIM_LEASE_MS: '5000',
      OUTBOX_UNPUBLISHED_WARNING_MS: '60000',
      INITIAL_CREDIT_BALANCE: '100',
    });
    appModule = (await import('../src/app.module.js')).AppModule;

    dataSource = new DataSource(
      createDatabaseOptions({
        DB_HOST: process.env.DB_HOST!,
        DB_PORT: Number(process.env.DB_PORT),
        DB_USERNAME: process.env.DB_USERNAME!,
        DB_DATABASE: process.env.DB_DATABASE!,
        DB_PASSWORD_FILE: process.env.DB_PASSWORD_FILE!,
      }),
    );
    await dataSource.initialize();
    await dataSource.dropDatabase();
    await dataSource.runMigrations({ transaction: 'all' });
    await connectAdmin();
    app = await startApplication();
  });

  beforeEach(async () => {
    // Keep scenarios independent even when a prior assertion failed after an
    // event was confirmed but before that event was consumed by the test.
    await adminChannel.purgeQueue(topology.observationQueue);
    await adminChannel.purgeQueue(`${topology.incomingQueue}.dlq`);
  });

  afterAll(async () => {
    await runCompose('up', '-d', '--wait', ...dockerServices).catch(
      () => undefined,
    );
    await app?.close().catch(() => undefined);

    if (!adminConnection) {
      await connectAdmin().catch(() => undefined);
    }
    if (adminChannel) {
      await adminChannel
        .deleteQueue(topology.observationQueue)
        .catch(() => undefined);
      await adminChannel
        .deleteQueue(topology.incomingQueue)
        .catch(() => undefined);
      await adminChannel
        .deleteQueue(`${topology.incomingQueue}.dlq`)
        .catch(() => undefined);
      for (let index = 1; index <= 5; index += 1) {
        await adminChannel
          .deleteQueue(`${topology.incomingQueue}.retry.${index}`)
          .catch(() => undefined);
      }
      await adminChannel
        .deleteExchange(topology.retryExchange)
        .catch(() => undefined);
      await adminChannel
        .deleteExchange(topology.retryReturnExchange)
        .catch(() => undefined);
      await adminChannel
        .deleteExchange(topology.deadLetterExchange)
        .catch(() => undefined);
      await adminChannel
        .deleteExchange(topology.domainExchange)
        .catch(() => undefined);
    }
    await publisherChannel?.close().catch(() => undefined);
    await adminChannel?.close().catch(() => undefined);
    await adminConnection?.close().catch(() => undefined);

    if (dataSource?.isInitialized) {
      await dataSource.undoLastMigration({ transaction: 'all' });
      const tables = (await dataSource.query(
        `
          SELECT table_name
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name <> 'credit_service_migrations'
        `,
      )) as unknown[];
      expect(tables).toEqual([]);
      await dataSource.destroy();
    }
  });

  it('processes and publishes a valid registration through the complete pipeline', async () => {
    const event = registration();
    await publishEvent(event);

    await waitForUserCounts(event.payload.userId, {
      accounts: 1,
      allocations: 1,
      inbox: 1,
      outbox: 1,
    });
    const { message, envelope } = await takeOutgoingForUser(
      event.payload.userId,
    );
    const stored = await waitFor(async () => {
      const [row] = (await dataSource.query(
        `
          SELECT envelope, published_at IS NOT NULL AS published
          FROM outbox_events
          WHERE event_id = $1
        `,
        [envelope.eventId],
      )) as Array<{
        envelope: CreditAccountInitialisedEvent;
        published: boolean;
      }>;

      return row?.published ? row : undefined;
    });

    expect(stored).toEqual({ envelope, published: true });
    expect(envelope.payload).toEqual({
      userId: event.payload.userId,
      creditAmountAllocated: 100,
      creditAllocationId: expect.any(String),
    });
    expect(Object.keys(envelope.payload)).toHaveLength(3);
    expect(message.fields.routingKey).toBe(outgoingRoutingKey);
    expect(message.properties.deliveryMode).toBe(2);
  });

  it('preserves idempotency for repeated, semantic, and concurrent duplicates', async () => {
    const repeated = registration();
    await publishEvent(repeated);
    await takeOutgoingForUser(repeated.payload.userId);
    await publishEvent(repeated);
    await waitForUserCounts(repeated.payload.userId, {
      accounts: 1,
      allocations: 1,
      inbox: 1,
      outbox: 1,
    });

    await publishEvent(registration(repeated.payload.userId));
    await waitForUserCounts(repeated.payload.userId, {
      accounts: 1,
      allocations: 1,
      inbox: 2,
      outbox: 1,
    });

    const concurrentUser = randomUUID();
    await Promise.all([
      publishEvent(registration(concurrentUser)),
      publishEvent(registration(concurrentUser)),
    ]);
    await waitForUserCounts(concurrentUser, {
      accounts: 1,
      allocations: 1,
      inbox: 2,
      outbox: 1,
    });
    const concurrentOutgoing = await takeOutgoingForUser(concurrentUser);
    expect(concurrentOutgoing.envelope.payload.userId).toBe(concurrentUser);
  });

  it('rolls back every retry before dead-lettering an invariant failure', async () => {
    const event = registration();
    const contracts = app.get(AccountEventContractValidator);
    const invalidResult: ContractValidationResult<CreditAccountInitialisedEvent> =
      {
        valid: false,
        code: 'INVALID_PAYLOAD',
        violations: [],
      };
    const validation = vi
      .spyOn(contracts, 'validateCreditAccountInitialised')
      .mockReturnValue(invalidResult);

    try {
      await publishEvent(event);
      const deadLetter = await takeMessage(
        `${topology.incomingQueue}.dlq`,
        20_000,
      );
      expect(deadLetter.properties.headers).toMatchObject({
        'x-retry-count': 5,
        'x-failure-category': 'PROCESSING_RETRIES_EXHAUSTED',
      });
      expect(validation).toHaveBeenCalledTimes(6);
      expect(await userCounts(event.payload.userId)).toEqual({
        accounts: 0,
        allocations: 0,
        inbox: 0,
        outbox: 0,
      });
    } finally {
      validation.mockRestore();
    }
  });

  it('dead-letters malformed JSON without changing persistent state', async () => {
    const [before] = (await dataSource.query(
      'SELECT COUNT(*)::int AS count FROM inbox_events',
    )) as Array<{ count: number }>;
    await publish(Buffer.from('{malformed-json'));
    const deadLetter = await takeMessage(`${topology.incomingQueue}.dlq`);
    const [after] = (await dataSource.query(
      'SELECT COUNT(*)::int AS count FROM inbox_events',
    )) as Array<{ count: number }>;

    expect(deadLetter.properties.headers).toMatchObject({
      'x-failure-category': 'MALFORMED_JSON',
    });
    expect(after.count).toBe(before.count);
  });

  it('keeps a committed delivery unacknowledged until processing returns', async () => {
    const event = registration();
    const initialization = app.get(AccountInitializationService);
    const original = initialization.process.bind(initialization);
    let reportCommitted!: () => void;
    let release!: () => void;
    const committed = new Promise<void>((resolve) => {
      reportCommitted = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const process = vi
      .spyOn(initialization, 'process')
      .mockImplementation(async (incoming) => {
        const outcome = await original(incoming);
        reportCommitted();
        await gate;
        return outcome;
      });

    try {
      await publishEvent(event);
      await committed;
      await waitFor(async () =>
        (await queueMetrics()).messages_unacknowledged === 1 ? true : undefined,
      );
      expect(await userCounts(event.payload.userId)).toEqual({
        accounts: 1,
        allocations: 1,
        inbox: 1,
        outbox: 1,
      });
      release();
      await waitFor(
        async () =>
          (await queueMetrics()).messages_unacknowledged === 0
            ? true
            : undefined,
        30_000,
      );
      await takeOutgoingForUser(event.payload.userId);
    } finally {
      release();
      process.mockRestore();
    }
  });

  it('publishes a committed pending event after an application restart', async () => {
    await app.close();
    app = await startApplication(true);
    const event = registration();
    await publishEvent(event);
    await waitForUserCounts(event.payload.userId, {
      accounts: 1,
      allocations: 1,
      inbox: 1,
      outbox: 1,
    });
    const [pending] = (await dataSource.query(
      `
        SELECT event_id, envelope, published_at
        FROM outbox_events
        WHERE envelope->'payload'->>'userId' = $1
      `,
      [event.payload.userId],
    )) as Array<{
      event_id: string;
      envelope: CreditAccountInitialisedEvent;
      published_at: Date | null;
    }>;
    expect(pending.published_at).toBeNull();

    await app.close();
    app = await startApplication();
    const published = await takeOutgoingForUser(event.payload.userId);
    expect(published.envelope).toEqual(pending.envelope);
    expect(published.envelope.eventId).toBe(pending.event_id);
    expect(published.message.fields.routingKey).toBe(outgoingRoutingKey);
    await waitFor(async () => {
      const [row] = (await dataSource.query(
        'SELECT published_at IS NOT NULL AS published FROM outbox_events WHERE event_id = $1',
        [pending.event_id],
      )) as Array<{ published: boolean }>;
      return row.published ? true : undefined;
    });
  });

  it('recovers the relay, database path, and consumer after infrastructure restarts', async () => {
    await runCompose('stop', 'credit-rabbitmq-recovery');
    const pending = registration();
    const initialization = app.get(AccountInitializationService);
    const outcome = await initialization.process(pending);
    expect(outcome.status).toBe('created');
    const [storedPending] = (await dataSource.query(
      `
        SELECT event_id, routing_key, envelope, published_at
        FROM outbox_events
        WHERE envelope->'payload'->>'userId' = $1
      `,
      [pending.payload.userId],
    )) as Array<{
      event_id: string;
      routing_key: string;
      envelope: CreditAccountInitialisedEvent;
      published_at: Date | null;
    }>;
    expect(storedPending.published_at).toBeNull();

    await runCompose('stop', 'credit-db-recovery');
    await runCompose('up', '-d', '--wait', ...dockerServices);
    await connectAdmin();

    const applicationDataSource = app.get(DataSource);
    await waitFor(async () => {
      await applicationDataSource.query('SELECT 1');
      return true;
    }, 30_000);

    const recoveredPublication = await takeOutgoingForUser(
      pending.payload.userId,
      30_000,
    );
    expect(recoveredPublication.envelope.payload.userId).toBe(
      pending.payload.userId,
    );
    expect(recoveredPublication.envelope).toEqual(storedPending.envelope);
    expect(recoveredPublication.envelope.eventId).toBe(storedPending.event_id);
    expect(recoveredPublication.message.fields.routingKey).toBe(
      storedPending.routing_key,
    );
    await waitFor(async () => {
      const counts = await userCounts(pending.payload.userId);
      return JSON.stringify(counts) ===
        JSON.stringify({ accounts: 1, allocations: 1, inbox: 1, outbox: 1 })
        ? true
        : undefined;
    }, 30_000);
    await waitFor(async () => {
      const [row] = (await dataSource.query(
        'SELECT published_at IS NOT NULL AS published FROM outbox_events WHERE event_id = $1',
        [storedPending.event_id],
      )) as Array<{ published: boolean }>;
      return row.published ? true : undefined;
    });

    const afterRecovery = registration();
    await publishEvent(afterRecovery);
    await waitForUserCounts(afterRecovery.payload.userId, {
      accounts: 1,
      allocations: 1,
      inbox: 1,
      outbox: 1,
    });
    const afterRecoveryPublication = await takeOutgoingForUser(
      afterRecovery.payload.userId,
    );
    expect(afterRecoveryPublication.envelope.payload.userId).toBe(
      afterRecovery.payload.userId,
    );
  });
});
