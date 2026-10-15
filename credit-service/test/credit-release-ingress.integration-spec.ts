import { randomUUID } from 'node:crypto';
import type { ErrandCancelledEvent } from '@foc/contracts';
import { DataSource } from 'typeorm';
import { createDatabaseOptions } from '../src/database/database-options.js';
import {
  CreditAccount,
  CreditOperation,
  CreditReservation,
  CreditTransaction,
  InboxEvent,
  OutboxEvent,
} from '../src/database/entities/index.js';
import { SerializableTransactionRunner } from '../src/database/serializable-transaction.runner.js';
import {
  CreditReleaseIngressInvariantError,
  hashErrandCancelledPayload,
  ReleaseService,
} from '../src/settlement/release.service.js';

function command(
  overrides: Partial<ErrandCancelledEvent> = {},
): ErrandCancelledEvent {
  const base: ErrandCancelledEvent = {
    eventId: randomUUID(),
    eventType: 'ErrandCancelled',
    timestamp: new Date().toISOString(),
    publisher: 'order-service',
    payload: { errandId: randomUUID() },
  };
  return { ...base, ...overrides };
}

describe('ReleaseService durable ingress', () => {
  let dataSource: DataSource;
  let service: ReleaseService;

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
    service = new ReleaseService(new SerializableTransactionRunner(dataSource));
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

  async function createReserveOperation(
    errandId: string,
    requesterUserId: string,
    amount: number,
  ): Promise<CreditOperation> {
    return dataSource.getRepository(CreditOperation).save({
      id: randomUUID(),
      errandId,
      operationType: 'RESERVE',
      status: 'PENDING',
      requesterUserId,
      courierUserId: null,
      amount,
      expectedAmount: null,
      commandEventId: null,
      requestPayloadHash: 'a'.repeat(64),
      attemptCount: 0,
      nextAttemptAt: new Date(),
      claimedBy: null,
      claimedUntil: null,
      lastError: null,
      rejectionReason: null,
      completionTransactionId: null,
      outcomeOutboxEventId: null,
    });
  }

  async function createReservation(
    errandId: string,
    requesterUserId: string,
    amount: number,
  ): Promise<CreditReservation> {
    await dataSource.getRepository(CreditAccount).save({
      userId: requesterUserId,
      creditBalance: 100 - amount,
      reservedBalance: amount,
    });
    const transaction = await dataSource.getRepository(CreditTransaction).save({
      id: randomUUID(),
      type: 'RESERVATION',
      amount,
      originBalanceType: 'CREDIT_BALANCE',
      destinationBalanceType: 'RESERVED_BALANCE',
      originUserId: requesterUserId,
      destinationUserId: requesterUserId,
      errandId,
    });
    return dataSource.getRepository(CreditReservation).save({
      id: randomUUID(),
      errandId,
      requesterUserId,
      reservedAmount: amount,
      status: 'ACTIVE',
      latestTransactionId: transaction.id,
    });
  }

  async function createOutcome(
    eventType: 'CreditReleaseSuccess' | 'CreditReleaseRejected',
  ): Promise<OutboxEvent> {
    const eventId = randomUUID();
    return dataSource.getRepository(OutboxEvent).save({
      eventId,
      eventType,
      routingKey:
        eventType === 'CreditReleaseSuccess'
          ? 'credit.release-success.v1'
          : 'credit.release-rejected.v1',
      envelope: { eventId },
      publishedAt: null,
      attemptCount: 0,
      lastError: null,
      claimedBy: null,
      claimedUntil: null,
    });
  }

  it('persists an unresolved pending release before acknowledgement', async () => {
    const incoming = command();

    const result = await service.accept(incoming);

    expect(result).toMatchObject({ status: 'accepted' });
    const operation = await dataSource
      .getRepository(CreditOperation)
      .findOneByOrFail({
        errandId: incoming.payload.errandId,
        operationType: 'RELEASE',
      });
    expect(operation).toMatchObject({
      status: 'PENDING',
      requesterUserId: null,
      amount: null,
      requestPayloadHash: hashErrandCancelledPayload(incoming.payload),
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

  it('uses the reservation as authoritative enrichment context', async () => {
    const incoming = command();
    const requesterUserId = randomUUID();
    await createReserveOperation(
      incoming.payload.errandId,
      requesterUserId,
      25,
    );
    await createReservation(incoming.payload.errandId, requesterUserId, 25);

    await service.accept(incoming);

    await expect(
      dataSource.getRepository(CreditOperation).findOneByOrFail({
        errandId: incoming.payload.errandId,
        operationType: 'RELEASE',
      }),
    ).resolves.toMatchObject({ requesterUserId, amount: 25 });
  });

  it('rejects conflicting reserve and reservation amounts without accepting ingress', async () => {
    const incoming = command();
    const requesterUserId = randomUUID();
    await createReserveOperation(
      incoming.payload.errandId,
      requesterUserId,
      20,
    );
    await createReservation(incoming.payload.errandId, requesterUserId, 25);

    await expect(service.accept(incoming)).rejects.toThrow(
      'Reservation and reserve operation disagree on amount',
    );

    expect(
      await dataSource.getRepository(CreditOperation).countBy({
        errandId: incoming.payload.errandId,
        operationType: 'RELEASE',
      }),
    ).toBe(0);
    expect(
      await dataSource
        .getRepository(InboxEvent)
        .countBy({ eventId: incoming.eventId }),
    ).toBe(0);
  });

  it('enriches a pending semantic replay from the reserve operation', async () => {
    const first = command();
    const accepted = await service.accept(first);
    const requesterUserId = randomUUID();
    await createReserveOperation(first.payload.errandId, requesterUserId, 30);
    const second = command({ payload: { ...first.payload } });

    const replay = await service.accept(second);

    expect(replay).toMatchObject({
      status: 'semantic-replay-pending',
      operationId:
        accepted.status === 'accepted' ? accepted.operationId : undefined,
    });
    await expect(
      dataSource.getRepository(CreditOperation).findOneByOrFail({
        errandId: first.payload.errandId,
        operationType: 'RELEASE',
      }),
    ).resolves.toMatchObject({ requesterUserId, amount: 30 });
    expect(await dataSource.getRepository(InboxEvent).count()).toBe(2);
  });

  it('deduplicates identical delivery and reports conflicting event identity', async () => {
    const incoming = command();
    const accepted = await service.accept(incoming);

    const duplicate = await service.accept(incoming);
    const conflict = await service.accept({
      ...incoming,
      payload: { errandId: randomUUID() },
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
  });

  it('replays success with the original release transaction', async () => {
    const first = command();
    const accepted = await service.accept(first);
    if (accepted.status !== 'accepted') {
      throw new Error('expected fresh release ingress');
    }
    const requesterUserId = randomUUID();
    await dataSource.getRepository(CreditAccount).save({
      userId: requesterUserId,
      creditBalance: 100,
      reservedBalance: 0,
    });
    const transaction = await dataSource.getRepository(CreditTransaction).save({
      id: randomUUID(),
      type: 'RELEASE',
      amount: 25,
      originBalanceType: 'RESERVED_BALANCE',
      destinationBalanceType: 'CREDIT_BALANCE',
      originUserId: requesterUserId,
      destinationUserId: requesterUserId,
      errandId: first.payload.errandId,
    });
    const originalOutcome = await createOutcome('CreditReleaseSuccess');
    await dataSource.getRepository(CreditOperation).update(
      { id: accepted.operationId },
      {
        status: 'SUCCEEDED',
        requesterUserId,
        amount: 25,
        completionTransactionId: transaction.id,
        outcomeOutboxEventId: originalOutcome.eventId,
      },
    );
    const replayCommand = command({ payload: { ...first.payload } });

    const replay = await service.accept(replayCommand);

    expect(replay).toMatchObject({
      status: 'semantic-replay-completed',
      operationId: accepted.operationId,
      transactionId: transaction.id,
    });
    const replayOutbox = await dataSource
      .getRepository(OutboxEvent)
      .findOneByOrFail({
        eventId:
          replay.status === 'semantic-replay-completed'
            ? replay.outboxEventId
            : '',
      });
    expect(replayOutbox).toMatchObject({
      eventType: 'CreditReleaseSuccess',
      routingKey: 'credit.release-success.v1',
      envelope: {
        timestamp: transaction.createdAt.toISOString(),
        payload: {
          errandId: first.payload.errandId,
          requesterUserId,
          releasedAmount: 25,
          creditTransactionId: transaction.id,
        },
      },
    });
    const duplicate = await service.accept(replayCommand);
    expect(duplicate).toMatchObject({
      status: 'duplicate-event',
      outboxEventId: replayOutbox.eventId,
    });
    expect(await dataSource.getRepository(CreditTransaction).count()).toBe(1);
    expect(await dataSource.getRepository(OutboxEvent).count()).toBe(2);
  });

  it.each(['RESERVATION_NOT_FOUND', 'ALREADY_TRANSFERRED'] as const)(
    'replays the established %s rejection',
    async (reason) => {
      const first = command();
      const accepted = await service.accept(first);
      if (accepted.status !== 'accepted') {
        throw new Error('expected fresh release ingress');
      }
      const requesterUserId = randomUUID();
      const originalOutcome = await createOutcome('CreditReleaseRejected');
      await dataSource.getRepository(CreditOperation).update(
        { id: accepted.operationId },
        {
          status: 'REJECTED',
          requesterUserId,
          amount: 25,
          rejectionReason: reason,
          outcomeOutboxEventId: originalOutcome.eventId,
        },
      );

      const replay = await service.accept(
        command({ payload: { ...first.payload } }),
      );

      expect(replay).toMatchObject({
        status: 'semantic-replay-completed',
        operationId: accepted.operationId,
        transactionId: null,
      });
      await expect(
        dataSource.getRepository(OutboxEvent).findOneByOrFail({
          eventId:
            replay.status === 'semantic-replay-completed'
              ? replay.outboxEventId
              : '',
        }),
      ).resolves.toMatchObject({
        eventType: 'CreditReleaseRejected',
        routingKey: 'credit.release-rejected.v1',
        envelope: {
          payload: {
            errandId: first.payload.errandId,
            requesterUserId,
            rejectionReason: reason,
          },
        },
      });
      expect(await dataSource.getRepository(CreditTransaction).count()).toBe(0);
    },
  );

  it('rolls back replay when terminal transaction evidence is inconsistent', async () => {
    const first = command();
    const accepted = await service.accept(first);
    if (accepted.status !== 'accepted') {
      throw new Error('expected fresh release ingress');
    }
    const requesterUserId = randomUUID();
    const otherUserId = randomUUID();
    await dataSource.getRepository(CreditAccount).save([
      { userId: requesterUserId, creditBalance: 100, reservedBalance: 0 },
      { userId: otherUserId, creditBalance: 100, reservedBalance: 0 },
    ]);
    const inconsistentTransaction = await dataSource
      .getRepository(CreditTransaction)
      .save({
        id: randomUUID(),
        type: 'TRANSFER',
        amount: 25,
        originBalanceType: 'RESERVED_BALANCE',
        destinationBalanceType: 'CREDIT_BALANCE',
        originUserId: requesterUserId,
        destinationUserId: otherUserId,
        errandId: first.payload.errandId,
      });
    const originalOutcome = await createOutcome('CreditReleaseSuccess');
    await dataSource.getRepository(CreditOperation).update(
      { id: accepted.operationId },
      {
        status: 'SUCCEEDED',
        requesterUserId,
        amount: 25,
        completionTransactionId: inconsistentTransaction.id,
        outcomeOutboxEventId: originalOutcome.eventId,
      },
    );

    await expect(
      service.accept(command({ payload: { ...first.payload } })),
    ).rejects.toBeInstanceOf(CreditReleaseIngressInvariantError);
    expect(await dataSource.getRepository(InboxEvent).count()).toBe(1);
    expect(await dataSource.getRepository(OutboxEvent).count()).toBe(1);
  });

  it('rolls back conflicting reservation and reserve requester context', async () => {
    const incoming = command();
    await createReserveOperation(incoming.payload.errandId, randomUUID(), 25);
    await createReservation(incoming.payload.errandId, randomUUID(), 25);

    await expect(service.accept(incoming)).rejects.toBeInstanceOf(
      CreditReleaseIngressInvariantError,
    );
    expect(
      await dataSource.getRepository(CreditOperation).countBy({
        operationType: 'RELEASE',
      }),
    ).toBe(0);
    expect(await dataSource.getRepository(InboxEvent).count()).toBe(0);
  });
});
