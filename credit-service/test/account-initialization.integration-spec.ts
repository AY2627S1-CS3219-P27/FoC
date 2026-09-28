import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AccountAllocationService } from '../src/account/account-allocation.service.js';
import {
  AccountInitializationInvariantError,
  AccountInitializationService,
} from '../src/account-initialization/account-initialization.service.js';
import type { EnvironmentVariables } from '../src/config/environment.js';
import {
  AccountEventContractValidator,
  CREDIT_ACCOUNT_INITIALISED_V1_ROUTING_KEY,
  type ContractValidationResult,
  type CreditAccountInitialisedEvent,
  type UserRegisteredEvent,
} from '@foc/contracts';
import { createDatabaseOptions } from '../src/database/database-options.js';
import {
  CreditAccount,
  CreditAllocation,
  InboxEvent,
  OutboxEvent,
} from '../src/database/entities/index.js';
import { SerializableTransactionRunner } from '../src/database/serializable-transaction.runner.js';

const OUTGOING_ROUTING_KEY = CREDIT_ACCOUNT_INITIALISED_V1_ROUTING_KEY;

function incomingEvent(
  overrides: Partial<UserRegisteredEvent> = {},
): UserRegisteredEvent {
  const base: UserRegisteredEvent = {
    eventId: randomUUID(),
    eventType: 'UserRegistered',
    timestamp: new Date().toISOString(),
    publisher: 'user-service',
    payload: {
      userId: randomUUID(),
      email: 'alex@example.edu',
      displayName: 'Alex',
    },
  };

  return { ...base, ...overrides };
}

describe('AccountInitializationService persistence', () => {
  let dataSource: DataSource;
  let transactions: SerializableTransactionRunner;
  let contracts: AccountEventContractValidator;

  function service(
    initialBalance = 100,
    validator: AccountEventContractValidator = contracts,
  ): AccountInitializationService {
    return new AccountInitializationService(
      transactions,
      new AccountAllocationService(
        new ConfigService<EnvironmentVariables, true>({
          INITIAL_CREDIT_BALANCE: initialBalance,
        }),
      ),
      validator,
      new ConfigService<EnvironmentVariables, true>({
        RABBITMQ_CREDIT_ACCOUNT_INITIALISED_ROUTING_KEY: OUTGOING_ROUTING_KEY,
      }),
    );
  }

  async function counts() {
    return {
      accounts: await dataSource.getRepository(CreditAccount).count(),
      allocations: await dataSource.getRepository(CreditAllocation).count(),
      inbox: await dataSource.getRepository(InboxEvent).count(),
      outbox: await dataSource.getRepository(OutboxEvent).count(),
    };
  }

  beforeAll(async () => {
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
    transactions = new SerializableTransactionRunner(dataSource);
    contracts = new AccountEventContractValidator();
  });

  beforeEach(async () => {
    await dataSource.query(
      'TRUNCATE TABLE inbox_events, outbox_events, credit_allocations, credit_accounts',
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.undoLastMigration({ transaction: 'all' });
      await dataSource.destroy();
    }
  });

  it('atomically creates the account, allocation, inbox, and valid outbox event', async () => {
    const event = incomingEvent();

    const result = await service().process(event);

    expect(result).toMatchObject({
      status: 'created',
      userId: event.payload.userId,
    });
    expect(await counts()).toEqual({
      accounts: 1,
      allocations: 1,
      inbox: 1,
      outbox: 1,
    });

    const allocation = await dataSource
      .getRepository(CreditAllocation)
      .findOneByOrFail({ userId: event.payload.userId });
    const account = await dataSource
      .getRepository(CreditAccount)
      .findOneByOrFail({ userId: event.payload.userId });
    const inbox = await dataSource
      .getRepository(InboxEvent)
      .findOneByOrFail({ eventId: event.eventId });
    const outbox = await dataSource
      .getRepository(OutboxEvent)
      .findOneByOrFail({});
    const envelope = outbox.envelope as CreditAccountInitialisedEvent;

    expect(account).toMatchObject({ creditBalance: 100, reservedBalance: 0 });
    expect(inbox.outcomeAllocationId).toBe(allocation.id);
    expect(outbox.routingKey).toBe(OUTGOING_ROUTING_KEY);
    expect(
      contracts.validate(CREDIT_ACCOUNT_INITIALISED_V1_ROUTING_KEY, envelope)
        .valid,
    ).toBe(true);
    expect(envelope.timestamp).toBe(allocation.createdAt.toISOString());
    expect(envelope.payload).toEqual({
      userId: event.payload.userId,
      creditAmountAllocated: 100,
      creditAllocationId: allocation.id,
    });
    expect(Object.keys(envelope.payload)).toHaveLength(3);
  });

  it('performs no writes for a sequential duplicate event ID', async () => {
    const event = incomingEvent();
    const processor = service();
    const created = await processor.process(event);
    if (created.status !== 'created') {
      throw new Error('expected initial event to create an allocation');
    }

    const duplicate = await processor.process(event);

    expect(duplicate).toMatchObject({
      status: 'duplicate-event',
      userId: event.payload.userId,
      allocationId: created.allocationId,
    });
    expect(await counts()).toEqual({
      accounts: 1,
      allocations: 1,
      inbox: 1,
      outbox: 1,
    });
  });

  it('rejects conflicting content under an established event ID without writes', async () => {
    const event = incomingEvent();
    const processor = service();
    await processor.process(event);

    const conflict = await processor.process({
      ...event,
      payload: { ...event.payload, email: 'changed@example.edu' },
    });

    expect(conflict).toEqual({
      status: 'event-id-conflict',
      eventId: event.eventId,
    });
    expect(await counts()).toEqual({
      accounts: 1,
      allocations: 1,
      inbox: 1,
      outbox: 1,
    });
  });

  it('links another event ID to the existing allocation without another outbox event', async () => {
    const first = incomingEvent();
    const second = incomingEvent({
      payload: { ...first.payload },
    });
    const processor = service();
    const created = await processor.process(first);
    if (created.status !== 'created') {
      throw new Error('expected initial event to create an allocation');
    }

    const existing = await processor.process(second);

    expect(existing).toMatchObject({
      status: 'existing-allocation',
      allocationId: created.allocationId,
    });
    expect(await counts()).toEqual({
      accounts: 1,
      allocations: 1,
      inbox: 2,
      outbox: 1,
    });
  });

  it('converges concurrent identical deliveries through the event advisory lock', async () => {
    const event = incomingEvent();
    const processor = service();

    const outcomes = await Promise.all([
      processor.process(event),
      processor.process(event),
    ]);

    expect(outcomes.map(({ status }) => status).sort()).toEqual([
      'created',
      'duplicate-event',
    ]);
    expect(await counts()).toEqual({
      accounts: 1,
      allocations: 1,
      inbox: 1,
      outbox: 1,
    });
  });

  it('converges concurrent semantic duplicates on one allocation and outbox event', async () => {
    const first = incomingEvent();
    const second = incomingEvent({ payload: { ...first.payload } });
    const processor = service();

    const outcomes = await Promise.all([
      processor.process(first),
      processor.process(second),
    ]);

    expect(outcomes.map(({ status }) => status).sort()).toEqual([
      'created',
      'existing-allocation',
    ]);
    expect(await counts()).toEqual({
      accounts: 1,
      allocations: 1,
      inbox: 2,
      outbox: 1,
    });
  });

  it('keeps the established amount after allocation configuration changes', async () => {
    const first = incomingEvent();
    await service(100).process(first);

    await service(250).process(
      incomingEvent({ payload: { ...first.payload } }),
    );

    await expect(
      dataSource
        .getRepository(CreditAccount)
        .findOneByOrFail({ userId: first.payload.userId }),
    ).resolves.toMatchObject({ creditBalance: 100, reservedBalance: 0 });
    expect(await dataSource.getRepository(OutboxEvent).count()).toBe(1);
  });

  it('rolls back all records when the constructed outgoing event is invalid', async () => {
    const invalidContracts = {
      validate:
        (): ContractValidationResult<CreditAccountInitialisedEvent> => ({
          valid: false,
          code: 'INVALID_PAYLOAD',
          violations: [],
        }),
    } as unknown as AccountEventContractValidator;

    await expect(
      service(100, invalidContracts).process(incomingEvent()),
    ).rejects.toBeInstanceOf(AccountInitializationInvariantError);
    expect(await counts()).toEqual({
      accounts: 0,
      allocations: 0,
      inbox: 0,
      outbox: 0,
    });
  });
});
