import { randomUUID } from 'node:crypto';
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
import { AdjustmentOperationProcessor } from '../src/reservation/adjustment-operation.processor.js';
import { CreditOperationStore } from '../src/reservation/credit-operation.store.js';
import {
  type CreditReservationAdjustmentCommand,
  ReservationAdjustmentService,
} from '../src/reservation/reservation-adjustment.service.js';
import { claimDueOperationsAndWait } from './support/credit-operation-test.helper.js';

function command(
  overrides: Partial<CreditReservationAdjustmentCommand> = {},
): CreditReservationAdjustmentCommand {
  const base: CreditReservationAdjustmentCommand = {
    eventId: randomUUID(),
    eventType: 'CreditReservationAdjustment',
    timestamp: new Date().toISOString(),
    publisher: 'order-service',
    payload: {
      errandId: randomUUID(),
      oldAmount: 50,
      newAmount: 80,
    },
  };
  return { ...base, ...overrides };
}

describe('durable reservation adjustment persistence', () => {
  let dataSource: DataSource;
  let ingress: ReservationAdjustmentService;
  let processor: AdjustmentOperationProcessor;
  let operationStore: CreditOperationStore;

  /**
   * Persistence fixture for adjustment preconditions. ACTIVE rows keep the
   * account, reservation, initial movement, and latest-transaction link in
   * sync. Non-ACTIVE rows are synthetic guard states until transfer and
   * release execution are implemented.
   */
  async function seedReservationState(options: {
    errandId: string;
    creditBalance?: number;
    reservedAmount?: number;
    status?: 'ACTIVE' | 'CONSUMED' | 'RELEASED';
  }) {
    const requesterUserId = randomUUID();
    const creditBalance = options.creditBalance ?? 100;
    const reservedAmount = options.reservedAmount ?? 50;
    await dataSource.getRepository(CreditAccount).save({
      userId: requesterUserId,
      creditBalance,
      reservedBalance: reservedAmount,
    });
    const transaction = await dataSource.getRepository(CreditTransaction).save({
      id: randomUUID(),
      type: 'RESERVATION',
      amount: reservedAmount,
      originBalanceType: 'CREDIT_BALANCE',
      destinationBalanceType: 'RESERVED_BALANCE',
      originUserId: requesterUserId,
      destinationUserId: requesterUserId,
      errandId: options.errandId,
    });
    const reservation = await dataSource.getRepository(CreditReservation).save({
      id: randomUUID(),
      errandId: options.errandId,
      requesterUserId,
      reservedAmount,
      status: options.status ?? 'ACTIVE',
      latestTransactionId: transaction.id,
    });
    return { requesterUserId, transaction, reservation };
  }

  async function execute(event: CreditReservationAdjustmentCommand) {
    const accepted = await ingress.accept(event);
    if (accepted.status !== 'accepted') {
      return accepted;
    }
    const operation = await claimDueOperationsAndWait({
      dataSource,
      operationStore,
      operationId: accepted.operationId,
      expectedOperationType: 'ADJUST',
      processClaimed: (operationId, workerId) =>
        processor.processClaimed(operationId, workerId),
    });
    if (operation.status === 'REJECTED') {
      return {
        status: 'rejected' as const,
        operationId: operation.id,
        reason: operation.rejectionReason!,
        outboxEventId: operation.outcomeOutboxEventId!,
      };
    }
    return {
      status: 'succeeded' as const,
      operationId: operation.id,
      transactionId: operation.completionTransactionId!,
      outboxEventId: operation.outcomeOutboxEventId!,
    };
  }

  async function outcomeCounts() {
    return {
      operations: await dataSource.getRepository(CreditOperation).count(),
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
    const transactions = new SerializableTransactionRunner(dataSource);
    ingress = new ReservationAdjustmentService(transactions);
    processor = new AdjustmentOperationProcessor(transactions);
    operationStore = new CreditOperationStore(dataSource);
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

  it('persists pending ingress without changing financial state', async () => {
    const event = command();
    const seeded = await seedReservationState({
      errandId: event.payload.errandId,
    });

    const result = await ingress.accept(event);

    expect(result).toMatchObject({ status: 'accepted' });
    const operation = await dataSource
      .getRepository(CreditOperation)
      .findOneByOrFail({ commandEventId: event.eventId });
    expect(operation).toMatchObject({
      operationType: 'ADJUST',
      status: 'PENDING',
      requesterUserId: null,
      amount: 80,
      expectedAmount: 50,
      attemptCount: 0,
      completionTransactionId: null,
      outcomeOutboxEventId: null,
    });
    await expect(
      dataSource
        .getRepository(CreditAccount)
        .findOneByOrFail({ userId: seeded.requesterUserId }),
    ).resolves.toMatchObject({ creditBalance: 100, reservedBalance: 50 });
    expect(await dataSource.getRepository(CreditTransaction).count()).toBe(1);
    expect(await dataSource.getRepository(OutboxEvent).count()).toBe(0);
    await expect(
      dataSource
        .getRepository(InboxEvent)
        .findOneByOrFail({ eventId: event.eventId }),
    ).resolves.toMatchObject({
      outcomeOperationId: operation.id,
      outcomeTransactionId: null,
      outcomeOutboxEventId: null,
    });
    await expect(
      operationStore.claim(randomUUID(), 10, 30_000),
    ).resolves.toEqual([
      expect.objectContaining({
        id: operation.id,
        operationType: 'ADJUST',
        attemptCount: 1,
      }),
    ]);
  });

  it.each([
    {
      name: 'increase',
      oldAmount: 50,
      newAmount: 80,
      creditBalance: 70,
      reservedBalance: 80,
      origin: 'CREDIT_BALANCE',
      destination: 'RESERVED_BALANCE',
    },
    {
      name: 'decrease',
      oldAmount: 50,
      newAmount: 20,
      creditBalance: 130,
      reservedBalance: 20,
      origin: 'RESERVED_BALANCE',
      destination: 'CREDIT_BALANCE',
    },
  ] as const)(
    'executes an adjustment $name atomically',
    async ({
      oldAmount,
      newAmount,
      creditBalance,
      reservedBalance,
      origin,
      destination,
    }) => {
      const event = command({
        payload: { errandId: randomUUID(), oldAmount, newAmount },
      });
      const seeded = await seedReservationState({
        errandId: event.payload.errandId,
      });

      const result = await execute(event);

      expect(result.status).toBe('succeeded');
      if (result.status !== 'succeeded') {
        throw new Error('expected adjustment success');
      }
      await expect(
        dataSource
          .getRepository(CreditAccount)
          .findOneByOrFail({ userId: seeded.requesterUserId }),
      ).resolves.toMatchObject({ creditBalance, reservedBalance });
      await expect(
        dataSource
          .getRepository(CreditReservation)
          .findOneByOrFail({ id: seeded.reservation.id }),
      ).resolves.toMatchObject({
        reservedAmount: newAmount,
        latestTransactionId: result.transactionId,
      });
      await expect(
        dataSource
          .getRepository(CreditTransaction)
          .findOneByOrFail({ id: result.transactionId }),
      ).resolves.toMatchObject({
        type: 'RESERVATION_ADJUSTMENT',
        amount: Math.abs(newAmount - oldAmount),
        originBalanceType: origin,
        destinationBalanceType: destination,
      });
      const operation = await dataSource
        .getRepository(CreditOperation)
        .findOneByOrFail({ commandEventId: event.eventId });
      expect(operation).toMatchObject({
        status: 'SUCCEEDED',
        requesterUserId: seeded.requesterUserId,
        completionTransactionId: result.transactionId,
        outcomeOutboxEventId: result.outboxEventId,
        claimedBy: null,
        claimedUntil: null,
      });
      await expect(
        dataSource
          .getRepository(InboxEvent)
          .findOneByOrFail({ eventId: event.eventId }),
      ).resolves.toMatchObject({
        outcomeOperationId: operation.id,
        outcomeTransactionId: result.transactionId,
        outcomeOutboxEventId: result.outboxEventId,
      });
    },
  );

  it('completes fresh no-op commands with one shared ledger reference', async () => {
    const errandId = randomUUID();
    const seeded = await seedReservationState({ errandId });
    const first = command({
      payload: { errandId, oldAmount: 50, newAmount: 50 },
    });
    const second = command({
      payload: { errandId, oldAmount: 50, newAmount: 50 },
    });

    const firstResult = await execute(first);
    const secondResult = await execute(second);

    expect(firstResult).toMatchObject({
      status: 'succeeded',
      transactionId: seeded.transaction.id,
    });
    expect(secondResult).toMatchObject({
      status: 'succeeded',
      transactionId: seeded.transaction.id,
    });
    expect(await dataSource.getRepository(CreditTransaction).count()).toBe(1);
    expect(await outcomeCounts()).toEqual({
      operations: 2,
      inbox: 2,
      outbox: 2,
    });
  });

  it.each([
    {
      name: 'missing reservation',
      reason: 'RESERVATION_NOT_FOUND',
      prepare: async (_event: CreditReservationAdjustmentCommand) => undefined,
    },
    {
      name: 'inactive reservation',
      reason: 'RESERVATION_NOT_FOUND',
      prepare: async (event: CreditReservationAdjustmentCommand) =>
        seedReservationState({
          errandId: event.payload.errandId,
          status: 'RELEASED',
        }),
    },
    {
      name: 'stale amount',
      reason: 'STALE_RESERVATION_AMOUNT',
      prepare: async (event: CreditReservationAdjustmentCommand) =>
        seedReservationState({ errandId: event.payload.errandId }),
    },
    {
      name: 'insufficient credit',
      reason: 'INSUFFICIENT_CREDITS',
      prepare: async (event: CreditReservationAdjustmentCommand) =>
        seedReservationState({
          errandId: event.payload.errandId,
          creditBalance: 20,
        }),
    },
  ] as const)(
    'records $name as a terminal business rejection',
    async ({ name, reason, prepare }) => {
      const event = command({
        payload: {
          errandId: randomUUID(),
          oldAmount: name === 'stale amount' ? 49 : 50,
          newAmount: 80,
        },
      });
      await prepare(event);
      const transactionsBefore = await dataSource
        .getRepository(CreditTransaction)
        .count();

      const result = await execute(event);

      expect(result).toMatchObject({ status: 'rejected', reason });
      const operation = await dataSource
        .getRepository(CreditOperation)
        .findOneByOrFail({ commandEventId: event.eventId });
      expect(operation).toMatchObject({
        status: 'REJECTED',
        rejectionReason: reason,
        completionTransactionId: null,
      });
      expect(await dataSource.getRepository(CreditTransaction).count()).toBe(
        transactionsBefore,
      );
      await expect(
        dataSource
          .getRepository(OutboxEvent)
          .findOneByOrFail({ eventId: operation.outcomeOutboxEventId! }),
      ).resolves.toMatchObject({
        eventType: 'CreditReservationAdjustmentRejected',
        envelope: {
          payload: {
            requestedAmount: 80,
            rejectionReason: reason,
          },
        },
      });
    },
  );

  it('deduplicates the same event and rejects conflicting event-ID reuse', async () => {
    const event = command();
    await seedReservationState({ errandId: event.payload.errandId });
    const completed = await execute(event);

    const duplicate = await ingress.accept(event);
    const conflict = await ingress.accept({
      ...event,
      payload: { ...event.payload, newAmount: 90 },
    });

    expect(duplicate).toMatchObject({
      status: 'duplicate-event',
      transactionId:
        completed.status === 'succeeded' ? completed.transactionId : undefined,
      outboxEventId:
        completed.status === 'succeeded' ? completed.outboxEventId : undefined,
    });
    expect(conflict).toEqual({
      status: 'event-id-conflict',
      eventId: event.eventId,
    });
    expect(await dataSource.getRepository(CreditTransaction).count()).toBe(2);
    expect(await outcomeCounts()).toEqual({
      operations: 1,
      inbox: 1,
      outbox: 1,
    });
  });

  it('treats a new event ID as a fresh command against current state', async () => {
    const event = command();
    await seedReservationState({ errandId: event.payload.errandId });
    const first = await execute(event);
    const repeated = await execute({
      ...event,
      eventId: randomUUID(),
      timestamp: new Date().toISOString(),
    });

    expect(first.status).toBe('succeeded');
    expect(repeated).toMatchObject({
      status: 'rejected',
      reason: 'STALE_RESERVATION_AMOUNT',
    });
    expect(await dataSource.getRepository(CreditTransaction).count()).toBe(2);
    expect(await outcomeCounts()).toEqual({
      operations: 2,
      inbox: 2,
      outbox: 2,
    });
  });

  it('reevaluates a prior rejection under a fresh event ID', async () => {
    const event = command();
    const seeded = await seedReservationState({
      errandId: event.payload.errandId,
      creditBalance: 20,
    });
    await expect(execute(event)).resolves.toMatchObject({
      status: 'rejected',
      reason: 'INSUFFICIENT_CREDITS',
    });
    await dataSource
      .getRepository(CreditAccount)
      .update({ userId: seeded.requesterUserId }, { creditBalance: 100 });

    const retried = await execute({
      ...event,
      eventId: randomUUID(),
      timestamp: new Date().toISOString(),
    });

    expect(retried.status).toBe('succeeded');
    expect(await outcomeCounts()).toEqual({
      operations: 2,
      inbox: 2,
      outbox: 2,
    });
  });

  it.each([
    ['old amount', 0, 50],
    ['new amount', 50, 0],
    ['unsafe new amount', 50, Number.MAX_SAFE_INTEGER + 1],
  ] as const)(
    'rejects an invalid %s before opening a transaction',
    async (_name, oldAmount, newAmount) => {
      const event = command({
        payload: { errandId: randomUUID(), oldAmount, newAmount },
      });

      await expect(ingress.accept(event)).rejects.toThrow(
        'must be a positive JavaScript-safe integer',
      );
      expect(await outcomeCounts()).toEqual({
        operations: 0,
        inbox: 0,
        outbox: 0,
      });
    },
  );

  it('rolls back financial completion while retaining durable ingress', async () => {
    const event = command();
    const seeded = await seedReservationState({
      errandId: event.payload.errandId,
    });
    await dataSource.query(`
      CREATE FUNCTION reject_test_adjustment_outbox()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'injected adjustment outbox failure';
      END;
      $$ LANGUAGE plpgsql
    `);
    await dataSource.query(`
      CREATE TRIGGER "TRG_test_reject_adjustment_outbox"
      BEFORE INSERT ON "outbox_events"
      FOR EACH ROW
      WHEN (NEW.event_type = 'CreditReservationAdjustmentSuccess')
      EXECUTE FUNCTION reject_test_adjustment_outbox()
    `);

    try {
      await expect(execute(event)).rejects.toThrow(
        'injected adjustment outbox failure',
      );
    } finally {
      await dataSource.query(
        'DROP TRIGGER "TRG_test_reject_adjustment_outbox" ON "outbox_events"',
      );
      await dataSource.query('DROP FUNCTION reject_test_adjustment_outbox()');
    }

    await expect(
      dataSource
        .getRepository(CreditAccount)
        .findOneByOrFail({ userId: seeded.requesterUserId }),
    ).resolves.toMatchObject({ creditBalance: 100, reservedBalance: 50 });
    await expect(
      dataSource
        .getRepository(CreditReservation)
        .findOneByOrFail({ id: seeded.reservation.id }),
    ).resolves.toMatchObject({
      reservedAmount: 50,
      latestTransactionId: seeded.transaction.id,
    });
    expect(await dataSource.getRepository(CreditTransaction).count()).toBe(1);
    expect(await dataSource.getRepository(OutboxEvent).count()).toBe(0);
    await expect(
      dataSource
        .getRepository(CreditOperation)
        .findOneByOrFail({ commandEventId: event.eventId }),
    ).resolves.toMatchObject({
      status: 'PENDING',
      completionTransactionId: null,
      outcomeOutboxEventId: null,
    });
    expect(await dataSource.getRepository(InboxEvent).count()).toBe(1);
  });

  it('serializes concurrent equivalent commands without double movement', async () => {
    const errandId = randomUUID();
    await seedReservationState({ errandId });
    const first = command({
      payload: { errandId, oldAmount: 50, newAmount: 70 },
    });
    const second = command({
      payload: { errandId, oldAmount: 50, newAmount: 70 },
    });

    const outcomes = await Promise.all([execute(first), execute(second)]);

    expect(outcomes.map(({ status }) => status).sort()).toEqual([
      'rejected',
      'succeeded',
    ]);
    expect(outcomes.find(({ status }) => status === 'rejected')).toMatchObject({
      reason: 'STALE_RESERVATION_AMOUNT',
    });
    expect(await dataSource.getRepository(CreditTransaction).count()).toBe(2);
    const reservation = await dataSource
      .getRepository(CreditReservation)
      .findOneByOrFail({ errandId });
    expect(reservation.reservedAmount).toBe(70);
    await expect(
      dataSource
        .getRepository(CreditAccount)
        .findOneByOrFail({ userId: reservation.requesterUserId }),
    ).resolves.toMatchObject({ creditBalance: 80, reservedBalance: 70 });
  });
});
