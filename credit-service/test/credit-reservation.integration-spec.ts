import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { createDatabaseOptions } from '../src/database/database-options.js';
import {
  CreditAccount,
  CreditReservation,
  CreditTransaction,
  InboxEvent,
  OutboxEvent,
} from '../src/database/entities/index.js';
import { SerializableTransactionRunner } from '../src/database/serializable-transaction.runner.js';
import {
  CREDIT_RESERVATION_REJECTED_ROUTING_KEY,
  CREDIT_RESERVATION_SUCCESS_ROUTING_KEY,
  type CreditReservationCommand,
  ReservationService,
} from '../src/reservation/reservation.service.js';

function command(
  overrides: Partial<CreditReservationCommand> = {},
): CreditReservationCommand {
  const base: CreditReservationCommand = {
    eventId: randomUUID(),
    eventType: 'CreditReservation',
    timestamp: new Date().toISOString(),
    publisher: 'order-service',
    payload: {
      errandId: randomUUID(),
      requesterUserId: randomUUID(),
      amount: 50,
    },
  };
  return { ...base, ...overrides };
}

describe('ReservationService persistence', () => {
  let dataSource: DataSource;
  let service: ReservationService;

  async function createAccount(
    userId: string,
    creditBalance = 100,
    reservedBalance = 0,
  ) {
    const accounts = dataSource.getRepository(CreditAccount);
    await accounts.save(
      accounts.create({ userId, creditBalance, reservedBalance }),
    );
  }

  async function counts() {
    return {
      reservations: await dataSource.getRepository(CreditReservation).count(),
      transactions: await dataSource.getRepository(CreditTransaction).count(),
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
    service = new ReservationService(
      new SerializableTransactionRunner(dataSource),
    );
  });

  beforeEach(async () => {
    await dataSource.query(
      'TRUNCATE TABLE inbox_events, credit_reservations, credit_transactions, outbox_events, credit_allocations, credit_accounts',
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(
        'TRUNCATE TABLE inbox_events, credit_reservations, credit_transactions, outbox_events, credit_allocations, credit_accounts',
      );
      await dataSource.undoLastMigration({ transaction: 'all' });
      await dataSource.undoLastMigration({ transaction: 'all' });
      await dataSource.destroy();
    }
  });

  it('atomically reserves an exact available balance and records its outcome', async () => {
    const event = command({
      payload: {
        errandId: randomUUID(),
        requesterUserId: randomUUID(),
        amount: 100,
      },
    });
    await createAccount(event.payload.requesterUserId);

    const result = await service.reserve(event);

    expect(result.status).toBe('created');
    if (result.status !== 'created') {
      throw new Error('expected a created reservation');
    }
    const account = await dataSource
      .getRepository(CreditAccount)
      .findOneByOrFail({ userId: event.payload.requesterUserId });
    const reservation = await dataSource
      .getRepository(CreditReservation)
      .findOneByOrFail({ id: result.reservationId });
    const transaction = await dataSource
      .getRepository(CreditTransaction)
      .findOneByOrFail({ id: result.transactionId });
    const inbox = await dataSource
      .getRepository(InboxEvent)
      .findOneByOrFail({ eventId: event.eventId });
    const outbox = await dataSource
      .getRepository(OutboxEvent)
      .findOneByOrFail({ eventId: result.outboxEventId });

    expect(account).toMatchObject({ creditBalance: 0, reservedBalance: 100 });
    expect(reservation).toMatchObject({
      errandId: event.payload.errandId,
      requesterUserId: event.payload.requesterUserId,
      reservedAmount: 100,
      status: 'ACTIVE',
      latestTransactionId: transaction.id,
    });
    expect(transaction).toMatchObject({
      type: 'RESERVATION',
      amount: 100,
      originUserId: event.payload.requesterUserId,
      destinationUserId: event.payload.requesterUserId,
      originBalanceType: 'CREDIT_BALANCE',
      destinationBalanceType: 'RESERVED_BALANCE',
      errandId: event.payload.errandId,
    });
    expect(inbox).toMatchObject({
      outcomeAllocationId: null,
      outcomeTransactionId: transaction.id,
      outcomeOutboxEventId: outbox.eventId,
    });
    expect(outbox.routingKey).toBe(CREDIT_RESERVATION_SUCCESS_ROUTING_KEY);
    expect(outbox.envelope).toEqual({
      eventId: outbox.eventId,
      eventType: 'CreditReservationSuccess',
      timestamp: transaction.createdAt.toISOString(),
      publisher: 'credit-service',
      payload: {
        errandId: event.payload.errandId,
        requesterUserId: event.payload.requesterUserId,
        reservedAmount: 100,
        creditTransactionId: transaction.id,
      },
    });
  });

  it.each([
    {
      name: 'missing account',
      creditBalance: null,
      reason: 'MISSING_BALANCE',
    },
    {
      name: 'insufficient spendable credits',
      creditBalance: 49,
      reason: 'INSUFFICIENT_CREDITS',
    },
  ] as const)(
    'commits a $name rejection without changing balances or ledger state',
    async ({ creditBalance, reason }) => {
      const event = command();
      if (creditBalance !== null) {
        await createAccount(event.payload.requesterUserId, creditBalance, 10);
      }

      const result = await service.reserve(event);

      expect(result).toMatchObject({ status: 'rejected', reason });
      expect(await counts()).toEqual({
        reservations: 0,
        transactions: 0,
        inbox: 1,
        outbox: 1,
      });
      if (creditBalance !== null) {
        await expect(
          dataSource
            .getRepository(CreditAccount)
            .findOneByOrFail({ userId: event.payload.requesterUserId }),
        ).resolves.toMatchObject({
          creditBalance,
          reservedBalance: 10,
        });
      }
      const inbox = await dataSource
        .getRepository(InboxEvent)
        .findOneByOrFail({ eventId: event.eventId });
      const outbox = await dataSource
        .getRepository(OutboxEvent)
        .findOneByOrFail({ eventId: inbox.outcomeOutboxEventId! });
      expect(inbox.outcomeTransactionId).toBeNull();
      expect(outbox.routingKey).toBe(CREDIT_RESERVATION_REJECTED_ROUTING_KEY);
      expect(outbox.envelope).toMatchObject({
        eventType: 'CreditReservationRejected',
        publisher: 'credit-service',
        payload: {
          errandId: event.payload.errandId,
          requesterUserId: event.payload.requesterUserId,
          requestedAmount: event.payload.amount,
          rejectionReason: reason,
        },
      });
    },
  );

  it('performs no writes for a duplicate event ID', async () => {
    const event = command();
    await createAccount(event.payload.requesterUserId);
    const created = await service.reserve(event);

    const duplicate = await service.reserve(event);

    expect(duplicate).toMatchObject({
      status: 'duplicate-event',
      eventId: event.eventId,
      transactionId:
        created.status === 'created' ? created.transactionId : undefined,
      outboxEventId:
        created.status === 'created' ? created.outboxEventId : undefined,
    });
    expect(await counts()).toEqual({
      reservations: 1,
      transactions: 1,
      inbox: 1,
      outbox: 1,
    });
  });

  it('rejects conflicting content under an established event ID without writes', async () => {
    const event = command();
    await createAccount(event.payload.requesterUserId);
    await service.reserve(event);

    const conflict = await service.reserve({
      ...event,
      payload: { ...event.payload, amount: event.payload.amount + 1 },
    });

    expect(conflict).toEqual({
      status: 'event-id-conflict',
      eventId: event.eventId,
    });
    expect(await counts()).toEqual({
      reservations: 1,
      transactions: 1,
      inbox: 1,
      outbox: 1,
    });
  });

  it('replays an equivalent reservation with its original transaction', async () => {
    const first = command();
    const second = command({ payload: { ...first.payload } });
    await createAccount(first.payload.requesterUserId);
    const created = await service.reserve(first);
    if (created.status !== 'created') {
      throw new Error('expected a created reservation');
    }

    const replayed = await service.reserve(second);

    expect(replayed).toMatchObject({
      status: 'existing-reservation',
      reservationId: created.reservationId,
      transactionId: created.transactionId,
    });
    expect(await counts()).toEqual({
      reservations: 1,
      transactions: 1,
      inbox: 2,
      outbox: 2,
    });
    await expect(
      dataSource
        .getRepository(CreditAccount)
        .findOneByOrFail({ userId: first.payload.requesterUserId }),
    ).resolves.toMatchObject({ creditBalance: 50, reservedBalance: 50 });
  });

  it.each([
    [
      'different amount',
      (event: CreditReservationCommand) => ({
        ...event.payload,
        amount: event.payload.amount + 1,
      }),
    ],
    [
      'different requester',
      (event: CreditReservationCommand) => ({
        ...event.payload,
        requesterUserId: randomUUID(),
      }),
    ],
  ] as const)(
    'rejects an existing errand with a %s as RESERVATION_CONFLICT',
    async (_name, conflictingPayload) => {
      const first = command();
      await createAccount(first.payload.requesterUserId);
      await service.reserve(first);
      const second = command({ payload: conflictingPayload(first) });

      const result = await service.reserve(second);

      expect(result).toMatchObject({
        status: 'rejected',
        reason: 'RESERVATION_CONFLICT',
      });
      expect(await counts()).toEqual({
        reservations: 1,
        transactions: 1,
        inbox: 2,
        outbox: 2,
      });
    },
  );

  it('rejects a non-active reservation as RESERVATION_CONFLICT', async () => {
    const first = command();
    await createAccount(first.payload.requesterUserId);
    await service.reserve(first);
    await dataSource
      .getRepository(CreditReservation)
      .update({ errandId: first.payload.errandId }, { status: 'RELEASED' });

    const result = await service.reserve(
      command({ payload: { ...first.payload } }),
    );

    expect(result).toMatchObject({
      status: 'rejected',
      reason: 'RESERVATION_CONFLICT',
    });
  });

  it('rejects invalid amounts before opening a transaction', async () => {
    const event = command({ payload: { ...command().payload, amount: 0 } });

    await expect(service.reserve(event)).rejects.toThrow(
      'Reservation amount must be a positive JavaScript-safe integer',
    );
    expect(await counts()).toEqual({
      reservations: 0,
      transactions: 0,
      inbox: 0,
      outbox: 0,
    });
  });

  it('rolls back balances and all records when outcome persistence fails', async () => {
    const event = command();
    await createAccount(event.payload.requesterUserId);
    await dataSource.query(`
      CREATE FUNCTION reject_test_reservation_outbox()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'injected reservation outbox failure';
      END;
      $$ LANGUAGE plpgsql
    `);
    await dataSource.query(`
      CREATE TRIGGER "TRG_test_reject_reservation_outbox"
      BEFORE INSERT ON "outbox_events"
      FOR EACH ROW
      WHEN (NEW.event_type = 'CreditReservationSuccess')
      EXECUTE FUNCTION reject_test_reservation_outbox()
    `);

    try {
      await expect(service.reserve(event)).rejects.toThrow(
        'injected reservation outbox failure',
      );
    } finally {
      await dataSource.query(
        'DROP TRIGGER "TRG_test_reject_reservation_outbox" ON "outbox_events"',
      );
      await dataSource.query('DROP FUNCTION reject_test_reservation_outbox()');
    }

    await expect(
      dataSource
        .getRepository(CreditAccount)
        .findOneByOrFail({ userId: event.payload.requesterUserId }),
    ).resolves.toMatchObject({ creditBalance: 100, reservedBalance: 0 });
    expect(await counts()).toEqual({
      reservations: 0,
      transactions: 0,
      inbox: 0,
      outbox: 0,
    });
  });

  it('converges concurrent commands for the same errand on one movement', async () => {
    const first = command();
    const second = command({ payload: { ...first.payload } });
    await createAccount(first.payload.requesterUserId);

    const outcomes = await Promise.all([
      service.reserve(first),
      service.reserve(second),
    ]);

    expect(outcomes.map(({ status }) => status).sort()).toEqual([
      'created',
      'existing-reservation',
    ]);
    expect(await counts()).toEqual({
      reservations: 1,
      transactions: 1,
      inbox: 2,
      outbox: 2,
    });
  });

  it('serializes different errands so concurrent reservations cannot overdraw', async () => {
    const requesterUserId = randomUUID();
    await createAccount(requesterUserId);
    const first = command({
      payload: { errandId: randomUUID(), requesterUserId, amount: 80 },
    });
    const second = command({
      payload: { errandId: randomUUID(), requesterUserId, amount: 80 },
    });

    const outcomes = await Promise.all([
      service.reserve(first),
      service.reserve(second),
    ]);

    expect(outcomes.map(({ status }) => status).sort()).toEqual([
      'created',
      'rejected',
    ]);
    const rejection = outcomes.find(({ status }) => status === 'rejected');
    expect(rejection).toMatchObject({ reason: 'INSUFFICIENT_CREDITS' });
    await expect(
      dataSource
        .getRepository(CreditAccount)
        .findOneByOrFail({ userId: requesterUserId }),
    ).resolves.toMatchObject({ creditBalance: 20, reservedBalance: 80 });
    expect(await counts()).toEqual({
      reservations: 1,
      transactions: 1,
      inbox: 2,
      outbox: 2,
    });
  });
});
