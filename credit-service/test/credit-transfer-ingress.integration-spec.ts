import { randomUUID } from 'node:crypto';
import type { ErrandCompletedEvent } from '@foc/contracts';
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
  CreditTransferIngressInvariantError,
  hashErrandCompletedPayload,
  TransferService,
} from '../src/settlement/transfer.service.js';

function command(
  overrides: Partial<ErrandCompletedEvent> = {},
): ErrandCompletedEvent {
  const base: ErrandCompletedEvent = {
    eventId: randomUUID(),
    eventType: 'ErrandCompleted',
    timestamp: new Date().toISOString(),
    publisher: 'order-service',
    payload: {
      errandId: randomUUID(),
      requesterUserId: randomUUID(),
      courierUserId: randomUUID(),
      amount: 25,
    },
  };
  return { ...base, ...overrides };
}

describe('TransferService durable ingress', () => {
  let dataSource: DataSource;
  let service: TransferService;

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
    service = new TransferService(
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

  it('persists one pending transfer without financial mutation', async () => {
    const incoming = command();

    const result = await service.accept(incoming);

    expect(result).toMatchObject({ status: 'accepted' });
    const operation = await dataSource
      .getRepository(CreditOperation)
      .findOneByOrFail({
        errandId: incoming.payload.errandId,
        operationType: 'TRANSFER',
      });
    expect(operation).toMatchObject({
      status: 'PENDING',
      requesterUserId: incoming.payload.requesterUserId,
      courierUserId: incoming.payload.courierUserId,
      amount: incoming.payload.amount,
      requestPayloadHash: hashErrandCompletedPayload(incoming.payload),
      completionTransactionId: null,
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

  it('deduplicates identical delivery and dead-letters conflicting identity data', async () => {
    const incoming = command();
    const accepted = await service.accept(incoming);

    const duplicate = await service.accept(incoming);
    const conflict = await service.accept({
      ...incoming,
      payload: { ...incoming.payload, amount: incoming.payload.amount + 1 },
    });

    expect(duplicate).toMatchObject({
      status: 'duplicate-event',
      operationId:
        accepted.status === 'accepted' ? accepted.operationId : undefined,
    });
    expect(conflict).toEqual({
      status: 'event-id-conflict',
      eventId: incoming.eventId,
    });
    expect(await dataSource.getRepository(CreditOperation).count()).toBe(1);
    expect(await dataSource.getRepository(InboxEvent).count()).toBe(1);
    expect(await dataSource.getRepository(OutboxEvent).count()).toBe(0);
  });

  it('links distinct equivalent notices even when their amounts differ', async () => {
    const first = command();
    const second = command({
      payload: { ...first.payload, amount: first.payload.amount + 10 },
    });

    const [firstResult, secondResult] = await Promise.all([
      service.accept(first),
      service.accept(second),
    ]);

    expect([firstResult.status, secondResult.status].sort()).toEqual([
      'accepted',
      'semantic-replay-pending',
    ]);
    const operations = await dataSource.getRepository(CreditOperation).find();
    expect(operations).toHaveLength(1);
    expect(await dataSource.getRepository(InboxEvent).count()).toBe(2);
    await expect(dataSource.getRepository(InboxEvent).find()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ outcomeOperationId: operations[0].id }),
        expect.objectContaining({ outcomeOperationId: operations[0].id }),
      ]),
    );
  });

  it.each(['requester', 'courier'] as const)(
    'rejects a distinct %s conflict without replacing the operation',
    async (participant) => {
      const first = command();
      const accepted = await service.accept(first);
      const conflicting = command({
        payload: {
          ...first.payload,
          ...(participant === 'requester'
            ? { requesterUserId: randomUUID() }
            : { courierUserId: randomUUID() }),
        },
      });

      const result = await service.accept(conflicting);

      expect(result).toMatchObject({
        status: 'rejected',
        reason: 'RESERVATION_USER_MISMATCH',
      });
      const operation = await dataSource
        .getRepository(CreditOperation)
        .findOneByOrFail({
          id: accepted.status === 'accepted' ? accepted.operationId : '',
        });
      expect(operation).toMatchObject({
        requesterUserId: first.payload.requesterUserId,
        courierUserId: first.payload.courierUserId,
        status: 'PENDING',
      });
      await expect(
        dataSource
          .getRepository(InboxEvent)
          .findOneByOrFail({ eventId: conflicting.eventId }),
      ).resolves.toMatchObject({
        outcomeOperationId: null,
        outcomeTransactionId: null,
        outcomeOutboxEventId:
          result.status === 'rejected' ? result.outboxEventId : undefined,
      });
      await expect(
        dataSource.getRepository(OutboxEvent).findOneByOrFail({
          eventId: result.status === 'rejected' ? result.outboxEventId : '',
        }),
      ).resolves.toMatchObject({
        eventType: 'CreditTransferRejected',
        routingKey: 'credit.transfer-rejected.v1',
        envelope: {
          payload: {
            requesterUserId: conflicting.payload.requesterUserId,
            courierUserId: conflicting.payload.courierUserId,
            rejectionReason: 'RESERVATION_USER_MISMATCH',
          },
        },
      });
    },
  );

  it('replays a successful outcome using the authoritative ledger amount', async () => {
    const first = command();
    const accepted = await service.accept(first);
    if (accepted.status !== 'accepted') {
      throw new Error('expected fresh transfer ingress');
    }
    await dataSource.getRepository(CreditAccount).save([
      {
        userId: first.payload.requesterUserId,
        creditBalance: 75,
        reservedBalance: 25,
      },
      {
        userId: first.payload.courierUserId,
        creditBalance: 125,
        reservedBalance: 0,
      },
    ]);
    const transaction = await dataSource.getRepository(CreditTransaction).save({
      id: randomUUID(),
      type: 'TRANSFER',
      amount: 25,
      originBalanceType: 'RESERVED_BALANCE',
      destinationBalanceType: 'CREDIT_BALANCE',
      originUserId: first.payload.requesterUserId,
      destinationUserId: first.payload.courierUserId,
      errandId: first.payload.errandId,
    });
    const originalOutboxId = randomUUID();
    await dataSource.getRepository(OutboxEvent).save({
      eventId: originalOutboxId,
      eventType: 'CreditTransferSucceeded',
      routingKey: 'credit.transfer-succeeded.v1',
      envelope: { eventId: originalOutboxId },
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
        completionTransactionId: transaction.id,
        outcomeOutboxEventId: originalOutboxId,
      },
    );
    const replay = command({
      payload: { ...first.payload, amount: 999 },
    });

    const result = await service.accept(replay);

    expect(result).toMatchObject({
      status: 'semantic-replay-completed',
      operationId: accepted.operationId,
      transactionId: transaction.id,
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
      eventType: 'CreditTransferSucceeded',
      routingKey: 'credit.transfer-succeeded.v1',
      envelope: {
        payload: {
          transferredAmount: 25,
          creditTransactionId: transaction.id,
        },
      },
    });
    expect(await dataSource.getRepository(CreditTransaction).count()).toBe(1);
  });

  it('replays an established rejection without re-evaluating it', async () => {
    const first = command();
    const accepted = await service.accept(first);
    if (accepted.status !== 'accepted') {
      throw new Error('expected fresh transfer ingress');
    }
    const originalOutboxId = randomUUID();
    await dataSource.getRepository(OutboxEvent).save({
      eventId: originalOutboxId,
      eventType: 'CreditTransferRejected',
      routingKey: 'credit.transfer-rejected.v1',
      envelope: { eventId: originalOutboxId },
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
        rejectionReason: 'RESERVATION_RELEASED',
        outcomeOutboxEventId: originalOutboxId,
      },
    );

    const result = await service.accept(
      command({ payload: { ...first.payload } }),
    );

    expect(result).toMatchObject({
      status: 'semantic-replay-completed',
      operationId: accepted.operationId,
      transactionId: null,
    });
    await expect(
      dataSource.getRepository(OutboxEvent).findOneByOrFail({
        eventId:
          result.status === 'semantic-replay-completed'
            ? result.outboxEventId
            : '',
      }),
    ).resolves.toMatchObject({
      envelope: {
        payload: { rejectionReason: 'RESERVATION_RELEASED' },
      },
    });
    expect(await dataSource.getRepository(OutboxEvent).count()).toBe(2);
  });

  it('does not emit the deferred archived-destination rejection', async () => {
    const first = command();
    const accepted = await service.accept(first);
    if (accepted.status !== 'accepted') {
      throw new Error('expected fresh transfer ingress');
    }
    const originalOutboxId = randomUUID();
    await dataSource.getRepository(OutboxEvent).save({
      eventId: originalOutboxId,
      eventType: 'CreditTransferRejected',
      routingKey: 'credit.transfer-rejected.v1',
      envelope: { eventId: originalOutboxId },
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
        outcomeOutboxEventId: originalOutboxId,
      },
    );

    await expect(
      service.accept(command({ payload: { ...first.payload } })),
    ).rejects.toBeInstanceOf(CreditTransferIngressInvariantError);
    expect(await dataSource.getRepository(InboxEvent).count()).toBe(1);
    expect(await dataSource.getRepository(OutboxEvent).count()).toBe(1);
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid amount %s before opening a transaction',
    async (amount) => {
      const incoming = command({
        payload: { ...command().payload, amount },
      });

      await expect(service.accept(incoming)).rejects.toThrow(
        'positive JavaScript-safe integer',
      );
      expect(await dataSource.getRepository(InboxEvent).count()).toBe(0);
      expect(await dataSource.getRepository(CreditOperation).count()).toBe(0);
    },
  );
});
