import { randomUUID } from 'node:crypto';
import type { CreditSettlementEvent } from '@foc/contracts';
import { DataSource } from 'typeorm';
import { createDatabaseOptions } from '../src/database/database-options.js';
import {
  CreditAccount,
  CreditOperation,
  CreditTransaction,
  InboxEvent,
  OutboxEvent,
} from '../src/database/entities/index.js';
import { SerializableTransactionRunner } from '../src/database/serializable-transaction.runner.js';
import {
  CreditSettlementIngressInvariantError,
  hashCreditSettlementPayload,
  SettlementService,
} from '../src/settlement/settlement.service.js';

function command(
  payloadOverrides: Partial<CreditSettlementEvent['payload']> = {},
  eventOverrides: Partial<Omit<CreditSettlementEvent, 'payload'>> = {},
): CreditSettlementEvent {
  return {
    eventId: randomUUID(),
    eventType: 'CreditSettlementRequested',
    timestamp: new Date().toISOString(),
    publisher: 'order-service',
    ...eventOverrides,
    payload: {
      errandId: randomUUID(),
      requesterUserId: randomUUID(),
      courierUserId: randomUUID(),
      courierAmount: 30,
      requesterAmount: 20,
      attempt: 1,
      ...payloadOverrides,
    },
  };
}

describe('SettlementService durable ingress', () => {
  let dataSource: DataSource;
  let service: SettlementService;

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
    service = new SettlementService(
      new SerializableTransactionRunner(dataSource),
    );
  });

  beforeEach(async () => {
    await dataSource.query(
      'TRUNCATE TABLE inbox_events, credit_operations, credit_reservations, credit_transactions, outbox_events, credit_allocations, credit_accounts',
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(
        'TRUNCATE TABLE inbox_events, credit_operations, credit_reservations, credit_transactions, outbox_events, credit_allocations, credit_accounts',
      );
      for (let index = 0; index < dataSource.migrations.length; index += 1) {
        await dataSource.undoLastMigration({ transaction: 'all' });
      }
      await dataSource.destroy();
    }
  });

  it('persists one pending settlement without financial mutation', async () => {
    const incoming = command();

    const result = await service.accept(incoming);

    expect(result).toMatchObject({ status: 'accepted' });
    const operation = await dataSource
      .getRepository(CreditOperation)
      .findOneByOrFail({
        errandId: incoming.payload.errandId,
        operationType: 'SETTLEMENT',
        settlementAttempt: incoming.payload.attempt,
      });
    expect(operation).toMatchObject({
      status: 'PENDING',
      requesterUserId: incoming.payload.requesterUserId,
      courierUserId: incoming.payload.courierUserId,
      amount: 50,
      requesterAmount: 20,
      courierAmount: 30,
      requestPayloadHash: hashCreditSettlementPayload(incoming.payload),
      requesterTransactionId: null,
      courierTransactionId: null,
      outcomeOutboxEventId: null,
    });
    await expect(
      dataSource
        .getRepository(InboxEvent)
        .findOneByOrFail({ eventId: incoming.eventId }),
    ).resolves.toMatchObject({
      outcomeOperationId: operation.id,
      outcomeTransactionId: null,
      outcomeOutboxEventId: null,
    });
    expect(await dataSource.getRepository(CreditTransaction).count()).toBe(0);
    expect(await dataSource.getRepository(OutboxEvent).count()).toBe(0);
  });

  it('deduplicates an event ID and rejects conflicting reuse', async () => {
    const incoming = command();
    const accepted = await service.accept(incoming);

    await expect(service.accept(incoming)).resolves.toMatchObject({
      status: 'duplicate-event',
      operationId:
        accepted.status === 'accepted' ? accepted.operationId : undefined,
    });
    await expect(
      service.accept({
        ...incoming,
        payload: {
          ...incoming.payload,
          courierAmount: incoming.payload.courierAmount + 1,
        },
      }),
    ).resolves.toMatchObject({ status: 'event-id-conflict' });
    expect(await dataSource.getRepository(CreditOperation).count()).toBe(1);
    expect(await dataSource.getRepository(InboxEvent).count()).toBe(1);
  });

  it('links identical same-attempt notices and rejects conflicting content', async () => {
    const first = command();
    const accepted = await service.accept(first);
    const replay = command({ ...first.payload });

    await expect(service.accept(replay)).resolves.toMatchObject({
      status: 'semantic-replay-pending',
      operationId:
        accepted.status === 'accepted' ? accepted.operationId : undefined,
    });
    await expect(
      service.accept(
        command({
          ...first.payload,
          courierAmount: first.payload.courierAmount - 1,
          requesterAmount: first.payload.requesterAmount + 1,
        }),
      ),
    ).resolves.toMatchObject({ status: 'attempt-conflict' });
    expect(await dataSource.getRepository(CreditOperation).count()).toBe(1);
    expect(await dataSource.getRepository(InboxEvent).count()).toBe(2);
  });

  it('serializes concurrent identical notices into one operation', async () => {
    const first = command();
    const second = command({ ...first.payload });

    const outcomes = await Promise.all([
      service.accept(first),
      service.accept(second),
    ]);

    expect(outcomes.map(({ status }) => status).sort()).toEqual([
      'accepted',
      'semantic-replay-pending',
    ]);
    expect(await dataSource.getRepository(CreditOperation).count()).toBe(1);
    expect(await dataSource.getRepository(InboxEvent).count()).toBe(2);
  });

  it('creates fresh work for a higher settlement attempt', async () => {
    const first = command();
    await service.accept(first);

    await expect(
      service.accept(command({ ...first.payload, attempt: 2 })),
    ).resolves.toMatchObject({ status: 'accepted' });

    const operations = await dataSource.getRepository(CreditOperation).find({
      order: { settlementAttempt: 'ASC' },
    });
    expect(operations.map(({ settlementAttempt }) => settlementAttempt)).toEqual([
      1, 2,
    ]);
  });

  it.each(['same participant', 'unsafe total'] as const)(
    'rejects an invalid command with %s without durable writes',
    async (scenario) => {
      const requesterUserId = randomUUID();
      const incoming =
        scenario === 'same participant'
          ? command({
              requesterUserId,
              courierUserId: requesterUserId,
            })
          : command({
              courierAmount: Number.MAX_SAFE_INTEGER,
              requesterAmount: 1,
            });

      await expect(service.accept(incoming)).resolves.toMatchObject({
        status: 'invalid-command',
      });
      expect(await dataSource.getRepository(InboxEvent).count()).toBe(0);
      expect(await dataSource.getRepository(CreditOperation).count()).toBe(0);
    },
  );

  it('replays a successful split from authoritative operation transactions', async () => {
    const first = command();
    const accepted = await service.accept(first);
    if (accepted.status !== 'accepted') {
      throw new Error('expected fresh settlement ingress');
    }
    await dataSource.getRepository(CreditAccount).save([
      {
        userId: first.payload.requesterUserId,
        creditBalance: 70,
        reservedBalance: 0,
      },
      {
        userId: first.payload.courierUserId,
        creditBalance: 130,
        reservedBalance: 0,
      },
    ]);
    const requesterTransaction = await dataSource
      .getRepository(CreditTransaction)
      .save({
        id: randomUUID(),
        type: 'RELEASE',
        amount: first.payload.requesterAmount,
        originBalanceType: 'RESERVED_BALANCE',
        destinationBalanceType: 'CREDIT_BALANCE',
        originUserId: first.payload.requesterUserId,
        destinationUserId: first.payload.requesterUserId,
        errandId: first.payload.errandId,
      });
    const courierTransaction = await dataSource
      .getRepository(CreditTransaction)
      .save({
        id: randomUUID(),
        type: 'TRANSFER',
        amount: first.payload.courierAmount,
        originBalanceType: 'RESERVED_BALANCE',
        destinationBalanceType: 'CREDIT_BALANCE',
        originUserId: first.payload.requesterUserId,
        destinationUserId: first.payload.courierUserId,
        errandId: first.payload.errandId,
      });
    const originalOutboxEventId = randomUUID();
    await dataSource.getRepository(OutboxEvent).save({
      eventId: originalOutboxEventId,
      eventType: 'CreditSettlementSucceeded',
      routingKey: 'credit.settlement-succeeded.v1',
      envelope: { eventId: originalOutboxEventId },
      publishedAt: null,
      attemptCount: 0,
      lastError: null,
      claimedBy: null,
      claimedUntil: null,
    });
    await dataSource.getRepository(CreditOperation).update(
      { id: accepted.operationId },
      {
        status: 'SUCCEEDED',
        requesterTransactionId: requesterTransaction.id,
        courierTransactionId: courierTransaction.id,
        outcomeOutboxEventId: originalOutboxEventId,
      },
    );

    const result = await service.accept(command({ ...first.payload }));

    expect(result).toMatchObject({
      status: 'semantic-replay-completed',
      operationId: accepted.operationId,
      requesterTransactionId: requesterTransaction.id,
      courierTransactionId: courierTransaction.id,
    });
    const replayOutbox = await dataSource
      .getRepository(OutboxEvent)
      .findOneByOrFail({
        eventId:
          result.status === 'semantic-replay-completed'
            ? result.outboxEventId
            : '',
      });
    expect(replayOutbox).toMatchObject({
      eventType: 'CreditSettlementSucceeded',
      routingKey: 'credit.settlement-succeeded.v1',
      envelope: {
        payload: {
          courierAmount: 30,
          requesterAmount: 20,
          courierCreditTransactionId: courierTransaction.id,
          requesterCreditTransactionId: requesterTransaction.id,
        },
      },
    });
    expect(await dataSource.getRepository(CreditTransaction).count()).toBe(2);
    expect(await dataSource.getRepository(OutboxEvent).count()).toBe(2);
  });

  it('replays an established rejection without re-evaluating it', async () => {
    const first = command();
    const accepted = await service.accept(first);
    if (accepted.status !== 'accepted') {
      throw new Error('expected fresh settlement ingress');
    }
    const originalOutboxEventId = randomUUID();
    await dataSource.getRepository(OutboxEvent).save({
      eventId: originalOutboxEventId,
      eventType: 'CreditSettlementRejected',
      routingKey: 'credit.settlement-rejected.v1',
      envelope: { eventId: originalOutboxEventId },
      publishedAt: null,
      attemptCount: 0,
      lastError: null,
      claimedBy: null,
      claimedUntil: null,
    });
    await dataSource.getRepository(CreditOperation).update(
      { id: accepted.operationId },
      {
        status: 'REJECTED',
        rejectionReason: 'AMOUNT_MISMATCH',
        outcomeOutboxEventId: originalOutboxEventId,
      },
    );

    const result = await service.accept(command({ ...first.payload }));

    expect(result).toMatchObject({
      status: 'semantic-replay-completed',
      operationId: accepted.operationId,
      requesterTransactionId: null,
      courierTransactionId: null,
    });
    await expect(
      dataSource.getRepository(OutboxEvent).findOneByOrFail({
        eventId:
          result.status === 'semantic-replay-completed'
            ? result.outboxEventId
            : '',
      }),
    ).resolves.toMatchObject({
      routingKey: 'credit.settlement-rejected.v1',
      envelope: { payload: { rejectionReason: 'AMOUNT_MISMATCH' } },
    });
  });

  it('does not replay the reserved archived-destination rejection', async () => {
    const first = command();
    const accepted = await service.accept(first);
    if (accepted.status !== 'accepted') {
      throw new Error('expected fresh settlement ingress');
    }
    const originalOutboxEventId = randomUUID();
    await dataSource.getRepository(OutboxEvent).save({
      eventId: originalOutboxEventId,
      eventType: 'CreditSettlementRejected',
      routingKey: 'credit.settlement-rejected.v1',
      envelope: { eventId: originalOutboxEventId },
      publishedAt: null,
      attemptCount: 0,
      lastError: null,
      claimedBy: null,
      claimedUntil: null,
    });
    await dataSource.getRepository(CreditOperation).update(
      { id: accepted.operationId },
      {
        status: 'REJECTED',
        rejectionReason: 'DESTINATION_ARCHIVED',
        outcomeOutboxEventId: originalOutboxEventId,
      },
    );

    await expect(
      service.accept(command({ ...first.payload })),
    ).rejects.toBeInstanceOf(CreditSettlementIngressInvariantError);
    expect(await dataSource.getRepository(InboxEvent).count()).toBe(1);
    expect(await dataSource.getRepository(OutboxEvent).count()).toBe(1);
  });
});
