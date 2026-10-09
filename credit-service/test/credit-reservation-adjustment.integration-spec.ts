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
import {
  CREDIT_RESERVATION_ADJUSTMENT_REJECTED_ROUTING_KEY,
  CREDIT_RESERVATION_ADJUSTMENT_SUCCESS_ROUTING_KEY,
  type CreditReservationAdjustmentCommand,
  ReservationAdjustmentService,
} from '../src/reservation/reservation-adjustment.service.js';

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

describe('ReservationAdjustmentService persistence', () => {
  let dataSource: DataSource;
  let service: ReservationAdjustmentService;

  async function seedActiveReservation(options: {
    errandId: string;
    creditBalance?: number;
    reservedAmount?: number;
    status?: 'ACTIVE' | 'CONSUMED' | 'RELEASED';
  }) {
    const requesterUserId = randomUUID();
    const creditBalance = options.creditBalance ?? 100;
    const reservedAmount = options.reservedAmount ?? 50;
    const accounts = dataSource.getRepository(CreditAccount);
    await accounts.save(
      accounts.create({
        userId: requesterUserId,
        creditBalance,
        reservedBalance: reservedAmount,
      }),
    );
    const transactions = dataSource.getRepository(CreditTransaction);
    const transaction = await transactions.save(
      transactions.create({
        id: randomUUID(),
        type: 'RESERVATION',
        amount: reservedAmount,
        originBalanceType: 'CREDIT_BALANCE',
        destinationBalanceType: 'RESERVED_BALANCE',
        originUserId: requesterUserId,
        destinationUserId: requesterUserId,
        errandId: options.errandId,
      }),
    );
    const reservations = dataSource.getRepository(CreditReservation);
    const reservation = await reservations.save(
      reservations.create({
        id: randomUUID(),
        errandId: options.errandId,
        requesterUserId,
        reservedAmount,
        status: options.status ?? 'ACTIVE',
        latestTransactionId: transaction.id,
      }),
    );
    return { requesterUserId, transaction, reservation };
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
    service = new ReservationAdjustmentService(
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
      await dataSource.undoLastMigration({ transaction: 'all' });
      await dataSource.undoLastMigration({ transaction: 'all' });
      await dataSource.destroy();
    }
  });

  it('increases an active reservation and records one adjustment movement', async () => {
    const event = command();
    const seeded = await seedActiveReservation({
      errandId: event.payload.errandId,
    });

    const result = await service.adjust(event);

    expect(result.status).toBe('adjusted');
    if (result.status !== 'adjusted') {
      throw new Error('expected an effective adjustment');
    }
    await expect(
      dataSource
        .getRepository(CreditAccount)
        .findOneByOrFail({ userId: seeded.requesterUserId }),
    ).resolves.toMatchObject({ creditBalance: 70, reservedBalance: 80 });
    await expect(
      dataSource
        .getRepository(CreditReservation)
        .findOneByOrFail({ id: seeded.reservation.id }),
    ).resolves.toMatchObject({
      reservedAmount: 80,
      latestTransactionId: result.transactionId,
    });
    await expect(
      dataSource
        .getRepository(CreditTransaction)
        .findOneByOrFail({ id: result.transactionId }),
    ).resolves.toMatchObject({
      type: 'RESERVATION_ADJUSTMENT',
      amount: 30,
      originBalanceType: 'CREDIT_BALANCE',
      destinationBalanceType: 'RESERVED_BALANCE',
      originUserId: seeded.requesterUserId,
      destinationUserId: seeded.requesterUserId,
    });
    const inbox = await dataSource
      .getRepository(InboxEvent)
      .findOneByOrFail({ eventId: event.eventId });
    const outbox = await dataSource
      .getRepository(OutboxEvent)
      .findOneByOrFail({ eventId: result.outboxEventId });
    expect(inbox).toMatchObject({
      outcomeOperationId: null,
      outcomeTransactionId: result.transactionId,
      outcomeOutboxEventId: result.outboxEventId,
    });
    expect(outbox.routingKey).toBe(
      CREDIT_RESERVATION_ADJUSTMENT_SUCCESS_ROUTING_KEY,
    );
    expect(outbox.envelope).toMatchObject({
      eventType: 'CreditReservationAdjustmentSuccess',
      publisher: 'credit-service',
      payload: {
        errandId: event.payload.errandId,
        newReservedAmount: 80,
        creditTransactionId: result.transactionId,
      },
    });
    expect(await outcomeCounts()).toEqual({
      operations: 0,
      inbox: 1,
      outbox: 1,
    });
  });

  it('decreases an active reservation with the reverse balance direction', async () => {
    const event = command({
      payload: { errandId: randomUUID(), oldAmount: 50, newAmount: 20 },
    });
    const seeded = await seedActiveReservation({
      errandId: event.payload.errandId,
    });

    const result = await service.adjust(event);

    expect(result.status).toBe('adjusted');
    if (result.status !== 'adjusted') {
      throw new Error('expected an effective adjustment');
    }
    await expect(
      dataSource
        .getRepository(CreditAccount)
        .findOneByOrFail({ userId: seeded.requesterUserId }),
    ).resolves.toMatchObject({ creditBalance: 130, reservedBalance: 20 });
    await expect(
      dataSource
        .getRepository(CreditTransaction)
        .findOneByOrFail({ id: result.transactionId }),
    ).resolves.toMatchObject({
      amount: 30,
      originBalanceType: 'RESERVED_BALANCE',
      destinationBalanceType: 'CREDIT_BALANCE',
    });
  });

  it('publishes a success for a valid no-op without another movement', async () => {
    const event = command({
      payload: { errandId: randomUUID(), oldAmount: 50, newAmount: 50 },
    });
    const seeded = await seedActiveReservation({
      errandId: event.payload.errandId,
    });

    const result = await service.adjust(event);

    expect(result).toMatchObject({
      status: 'no-op',
      transactionId: seeded.transaction.id,
    });
    expect(await dataSource.getRepository(CreditTransaction).count()).toBe(1);
    await expect(
      dataSource
        .getRepository(CreditAccount)
        .findOneByOrFail({ userId: seeded.requesterUserId }),
    ).resolves.toMatchObject({ creditBalance: 100, reservedBalance: 50 });
    expect(await outcomeCounts()).toEqual({
      operations: 0,
      inbox: 1,
      outbox: 1,
    });
  });

  it.each([
    {
      name: 'a missing reservation',
      reason: 'RESERVATION_NOT_FOUND',
      prepare: async (_event: CreditReservationAdjustmentCommand) => undefined,
    },
    {
      name: 'a non-active reservation',
      reason: 'RESERVATION_NOT_FOUND',
      prepare: async (event: CreditReservationAdjustmentCommand) =>
        seedActiveReservation({
          errandId: event.payload.errandId,
          status: 'RELEASED',
        }),
    },
    {
      name: 'a stale previous amount',
      reason: 'STALE_RESERVATION_AMOUNT',
      prepare: async (event: CreditReservationAdjustmentCommand) =>
        seedActiveReservation({ errandId: event.payload.errandId }),
    },
    {
      name: 'insufficient spendable credits',
      reason: 'INSUFFICIENT_CREDITS',
      prepare: async (event: CreditReservationAdjustmentCommand) =>
        seedActiveReservation({
          errandId: event.payload.errandId,
          creditBalance: 20,
        }),
    },
  ] as const)(
    'records $name as a business rejection without a movement',
    async ({ name, reason, prepare }) => {
      const event = command({
        payload: {
          errandId: randomUUID(),
          oldAmount: name === 'a stale previous amount' ? 49 : 50,
          newAmount: 80,
        },
      });
      await prepare(event);
      const transactionsBefore = await dataSource
        .getRepository(CreditTransaction)
        .count();

      const result = await service.adjust(event);

      expect(result).toMatchObject({ status: 'rejected', reason });
      expect(await dataSource.getRepository(CreditTransaction).count()).toBe(
        transactionsBefore,
      );
      const inbox = await dataSource
        .getRepository(InboxEvent)
        .findOneByOrFail({ eventId: event.eventId });
      const outbox = await dataSource
        .getRepository(OutboxEvent)
        .findOneByOrFail({ eventId: inbox.outcomeOutboxEventId! });
      expect(inbox).toMatchObject({
        outcomeOperationId: null,
        outcomeTransactionId: null,
      });
      expect(outbox.routingKey).toBe(
        CREDIT_RESERVATION_ADJUSTMENT_REJECTED_ROUTING_KEY,
      );
      expect(outbox.envelope).toMatchObject({
        eventType: 'CreditReservationAdjustmentRejected',
        payload: {
          errandId: event.payload.errandId,
          requestedAmount: event.payload.newAmount,
          rejectionReason: reason,
        },
      });
      expect(await outcomeCounts()).toEqual({
        operations: 0,
        inbox: 1,
        outbox: 1,
      });
    },
  );

  it('checks the previous amount before accepting a no-op', async () => {
    const event = command({
      payload: { errandId: randomUUID(), oldAmount: 40, newAmount: 40 },
    });
    await seedActiveReservation({ errandId: event.payload.errandId });

    await expect(service.adjust(event)).resolves.toMatchObject({
      status: 'rejected',
      reason: 'STALE_RESERVATION_AMOUNT',
    });
  });

  it('deduplicates an identical event without replaying the adjustment or outcome', async () => {
    const event = command();
    const seeded = await seedActiveReservation({
      errandId: event.payload.errandId,
    });
    const adjusted = await service.adjust(event);

    const duplicate = await service.adjust(event);

    expect(duplicate).toMatchObject({
      status: 'duplicate-event',
      transactionId:
        adjusted.status === 'adjusted' ? adjusted.transactionId : undefined,
      outboxEventId:
        adjusted.status === 'adjusted' ? adjusted.outboxEventId : undefined,
    });
    expect(await dataSource.getRepository(CreditTransaction).count()).toBe(2);
    await expect(
      dataSource
        .getRepository(CreditAccount)
        .findOneByOrFail({ userId: seeded.requesterUserId }),
    ).resolves.toMatchObject({ creditBalance: 70, reservedBalance: 80 });
    expect(await outcomeCounts()).toEqual({
      operations: 0,
      inbox: 1,
      outbox: 1,
    });
  });

  it('treats an equivalent adjustment with a new event ID as a fresh stale command', async () => {
    const event = command();
    const seeded = await seedActiveReservation({
      errandId: event.payload.errandId,
    });
    const adjusted = await service.adjust(event);
    if (adjusted.status !== 'adjusted') {
      throw new Error('expected the first adjustment to succeed');
    }

    const repeated = await service.adjust({
      ...event,
      eventId: randomUUID(),
      timestamp: new Date().toISOString(),
    });

    expect(repeated).toMatchObject({
      status: 'rejected',
      reason: 'STALE_RESERVATION_AMOUNT',
    });
    if (repeated.status !== 'rejected') {
      throw new Error('expected the repeated adjustment to be stale');
    }
    expect(await dataSource.getRepository(CreditTransaction).count()).toBe(2);
    await expect(
      dataSource
        .getRepository(CreditAccount)
        .findOneByOrFail({ userId: seeded.requesterUserId }),
    ).resolves.toMatchObject({ creditBalance: 70, reservedBalance: 80 });
    await expect(
      dataSource
        .getRepository(CreditReservation)
        .findOneByOrFail({ id: seeded.reservation.id }),
    ).resolves.toMatchObject({
      reservedAmount: 80,
      latestTransactionId: adjusted.transactionId,
    });
    const repeatedInbox = await dataSource
      .getRepository(InboxEvent)
      .findOneByOrFail({ eventId: repeated.eventId });
    expect(repeatedInbox).toMatchObject({
      outcomeTransactionId: null,
      outcomeOutboxEventId: repeated.outboxEventId,
    });
    await expect(
      dataSource
        .getRepository(OutboxEvent)
        .findOneByOrFail({ eventId: repeated.outboxEventId }),
    ).resolves.toMatchObject({
      eventType: 'CreditReservationAdjustmentRejected',
      envelope: {
        payload: { rejectionReason: 'STALE_RESERVATION_AMOUNT' },
      },
    });
    expect(await outcomeCounts()).toEqual({
      operations: 0,
      inbox: 2,
      outbox: 2,
    });
  });

  it('reevaluates an earlier rejection when a new event ID arrives after state changes', async () => {
    const event = command();
    const seeded = await seedActiveReservation({
      errandId: event.payload.errandId,
      creditBalance: 20,
    });
    await expect(service.adjust(event)).resolves.toMatchObject({
      status: 'rejected',
      reason: 'INSUFFICIENT_CREDITS',
    });
    await dataSource
      .getRepository(CreditAccount)
      .update({ userId: seeded.requesterUserId }, { creditBalance: 100 });

    const retried = await service.adjust({
      ...event,
      eventId: randomUUID(),
      timestamp: new Date().toISOString(),
    });

    expect(retried.status).toBe('adjusted');
    if (retried.status !== 'adjusted') {
      throw new Error('expected the fresh adjustment command to succeed');
    }
    expect(await dataSource.getRepository(CreditTransaction).count()).toBe(2);
    await expect(
      dataSource
        .getRepository(CreditAccount)
        .findOneByOrFail({ userId: seeded.requesterUserId }),
    ).resolves.toMatchObject({ creditBalance: 70, reservedBalance: 80 });
    await expect(
      dataSource
        .getRepository(CreditReservation)
        .findOneByOrFail({ id: seeded.reservation.id }),
    ).resolves.toMatchObject({
      reservedAmount: 80,
      latestTransactionId: retried.transactionId,
    });
    expect(await outcomeCounts()).toEqual({
      operations: 0,
      inbox: 2,
      outbox: 2,
    });
  });

  it('reports conflicting reuse of an adjustment event ID without writes', async () => {
    const event = command();
    await seedActiveReservation({ errandId: event.payload.errandId });
    await service.adjust(event);

    const conflict = await service.adjust({
      ...event,
      payload: { ...event.payload, newAmount: 90 },
    });

    expect(conflict).toEqual({
      status: 'event-id-conflict',
      eventId: event.eventId,
    });
    expect(await dataSource.getRepository(CreditTransaction).count()).toBe(2);
    expect(await outcomeCounts()).toEqual({
      operations: 0,
      inbox: 1,
      outbox: 1,
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

      await expect(service.adjust(event)).rejects.toThrow(
        'must be a positive JavaScript-safe integer',
      );
      expect(await outcomeCounts()).toEqual({
        operations: 0,
        inbox: 0,
        outbox: 0,
      });
    },
  );

  it('rolls back the complete adjustment when outcome persistence fails', async () => {
    const event = command();
    const seeded = await seedActiveReservation({
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
      await expect(service.adjust(event)).rejects.toThrow(
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
    expect(await outcomeCounts()).toEqual({
      operations: 0,
      inbox: 0,
      outbox: 0,
    });
  });

  it('serializes equivalent adjustments with distinct event IDs without double movement', async () => {
    const errandId = randomUUID();
    await seedActiveReservation({ errandId });
    const first = command({
      payload: { errandId, oldAmount: 50, newAmount: 70 },
    });
    const second = command({
      payload: { errandId, oldAmount: 50, newAmount: 70 },
    });

    const outcomes = await Promise.all([
      service.adjust(first),
      service.adjust(second),
    ]);

    expect(outcomes.map(({ status }) => status).sort()).toEqual([
      'adjusted',
      'rejected',
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
    expect(await outcomeCounts()).toEqual({
      operations: 0,
      inbox: 2,
      outbox: 2,
    });
  });
});
