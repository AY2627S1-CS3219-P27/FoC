import { randomUUID } from 'node:crypto';
import type {
  CreditSettlementEvent,
  ErrandCompletedEvent,
} from '@foc/contracts';
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
import { CreditOperationStore } from '../src/reservation/credit-operation.store.js';
import { ReleaseOperationProcessor } from '../src/settlement/release-operation.processor.js';
import { ReleaseService } from '../src/settlement/release.service.js';
import {
  CreditSettlementExecutionError,
  SettlementOperationProcessor,
} from '../src/settlement/settlement-operation.processor.js';
import { SettlementService } from '../src/settlement/settlement.service.js';
import { TransferOperationProcessor } from '../src/settlement/transfer-operation.processor.js';
import { TransferService } from '../src/settlement/transfer.service.js';

function command(
  payloadOverrides: Partial<CreditSettlementEvent['payload']> = {},
): CreditSettlementEvent {
  return {
    eventId: randomUUID(),
    eventType: 'CreditSettlementRequested',
    timestamp: new Date().toISOString(),
    publisher: 'order-service',
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

describe('SettlementOperationProcessor', () => {
  let dataSource: DataSource;
  let ingress: SettlementService;
  let transferIngress: TransferService;
  let releaseIngress: ReleaseService;
  let processor: SettlementOperationProcessor;
  let transferProcessor: TransferOperationProcessor;
  let releaseProcessor: ReleaseOperationProcessor;
  let operationStore: CreditOperationStore;

  async function createAccount(
    userId: string,
    creditBalance: number,
    reservedBalance: number,
  ): Promise<void> {
    const accounts = dataSource.getRepository(CreditAccount);
    await accounts.save(
      accounts.create({ userId, creditBalance, reservedBalance }),
    );
  }

  async function createReservation(
    event: CreditSettlementEvent,
    options: {
      amount?: number;
      requesterUserId?: string;
      status?: 'ACTIVE' | 'CONSUMED' | 'RELEASED';
    } = {},
  ): Promise<CreditReservation> {
    const requesterUserId =
      options.requesterUserId ?? event.payload.requesterUserId;
    const amount = options.amount ?? 50;
    const transactions = dataSource.getRepository(CreditTransaction);
    const reservationTransaction = await transactions.save(
      transactions.create({
        id: randomUUID(),
        type: 'RESERVATION',
        amount,
        originBalanceType: 'CREDIT_BALANCE',
        destinationBalanceType: 'RESERVED_BALANCE',
        originUserId: requesterUserId,
        destinationUserId: requesterUserId,
        errandId: event.payload.errandId,
      }),
    );
    const reservations = dataSource.getRepository(CreditReservation);
    return reservations.save(
      reservations.create({
        id: randomUUID(),
        errandId: event.payload.errandId,
        requesterUserId,
        reservedAmount: amount,
        status: options.status ?? 'ACTIVE',
        latestTransactionId: reservationTransaction.id,
      }),
    );
  }

  async function acceptAndClaim(event: CreditSettlementEvent): Promise<{
    operationId: string;
    workerId: string;
  }> {
    const accepted = await ingress.accept(event);
    if (accepted.status !== 'accepted') {
      throw new Error('expected fresh settlement ingress');
    }
    const workerId = randomUUID();
    const claimed = await operationStore.claim(workerId, 10, 30_000);
    expect(claimed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: accepted.operationId,
          operationType: 'SETTLEMENT',
        }),
      ]),
    );
    return { operationId: accepted.operationId, workerId };
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
    ingress = new SettlementService(transactions);
    transferIngress = new TransferService(transactions);
    releaseIngress = new ReleaseService(transactions);
    processor = new SettlementOperationProcessor(transactions);
    transferProcessor = new TransferOperationProcessor(transactions);
    releaseProcessor = new ReleaseOperationProcessor(transactions);
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

  it.each([
    ['full requester refund', 50, 0, 1],
    ['full courier payout', 0, 50, 1],
    ['split payout', 20, 30, 2],
  ] as const)(
    'atomically executes a %s (%i requester, %i courier, %i ledger rows)',
    async (_scenario, requesterAmount, courierAmount, ledgerCount) => {
      const event = command({ requesterAmount, courierAmount });
      await createAccount(event.payload.requesterUserId, 50, 50);
      await createAccount(event.payload.courierUserId, 10, 0);
      await createReservation(event);
      const accepted = await ingress.accept(event);
      if (accepted.status !== 'accepted') {
        throw new Error('expected fresh settlement ingress');
      }
      const replay = command({ ...event.payload });
      await expect(ingress.accept(replay)).resolves.toMatchObject({
        status: 'semantic-replay-pending',
        operationId: accepted.operationId,
      });
      const workerId = randomUUID();
      await operationStore.claim(workerId, 10, 30_000);

      const result = await processor.processClaimed(
        accepted.operationId,
        workerId,
      );

      expect(result).toMatchObject({ status: 'succeeded' });
      if (result.status !== 'succeeded') {
        throw new Error('expected successful settlement');
      }
      const [requester, courier, reservation, operation, outbox, ledger] =
        await Promise.all([
          dataSource
            .getRepository(CreditAccount)
            .findOneByOrFail({ userId: event.payload.requesterUserId }),
          dataSource
            .getRepository(CreditAccount)
            .findOneByOrFail({ userId: event.payload.courierUserId }),
          dataSource
            .getRepository(CreditReservation)
            .findOneByOrFail({ errandId: event.payload.errandId }),
          dataSource
            .getRepository(CreditOperation)
            .findOneByOrFail({ id: accepted.operationId }),
          dataSource
            .getRepository(OutboxEvent)
            .findOneByOrFail({ eventId: result.outboxEventId }),
          dataSource.getRepository(CreditTransaction).find({
            where: { errandId: event.payload.errandId },
            order: { createdAt: 'ASC' },
          }),
        ]);
      expect(requester).toMatchObject({
        creditBalance: 50 + requesterAmount,
        reservedBalance: 0,
      });
      expect(courier).toMatchObject({
        creditBalance: 10 + courierAmount,
        reservedBalance: 0,
      });
      expect(
        requester.creditBalance +
          requester.reservedBalance +
          courier.creditBalance +
          courier.reservedBalance,
      ).toBe(110);

      const settlementLedger = ledger.filter(
        ({ type }) => type === 'RELEASE' || type === 'TRANSFER',
      );
      expect(settlementLedger).toHaveLength(ledgerCount);
      const requesterTransaction =
        settlementLedger.find(({ type }) => type === 'RELEASE') ?? null;
      const courierTransaction =
        settlementLedger.find(({ type }) => type === 'TRANSFER') ?? null;
      if (requesterAmount > 0) {
        expect(requesterTransaction).toMatchObject({
          id: result.requesterTransactionId,
          amount: requesterAmount,
          originUserId: event.payload.requesterUserId,
          destinationUserId: event.payload.requesterUserId,
        });
      } else {
        expect(requesterTransaction).toBeNull();
      }
      if (courierAmount > 0) {
        expect(courierTransaction).toMatchObject({
          id: result.courierTransactionId,
          amount: courierAmount,
          originUserId: event.payload.requesterUserId,
          destinationUserId: event.payload.courierUserId,
        });
      } else {
        expect(courierTransaction).toBeNull();
      }
      expect(result.requesterTransactionId).toEqual(
        requesterAmount > 0 ? expect.any(String) : null,
      );
      expect(result.courierTransactionId).toEqual(
        courierAmount > 0 ? expect.any(String) : null,
      );
      expect(reservation).toMatchObject({
        status: 'CONSUMED',
        latestTransactionId:
          result.courierTransactionId ?? result.requesterTransactionId,
      });
      expect(operation).toMatchObject({
        status: 'SUCCEEDED',
        completionTransactionId: null,
        requesterTransactionId: result.requesterTransactionId,
        courierTransactionId: result.courierTransactionId,
        outcomeOutboxEventId: result.outboxEventId,
        claimedBy: null,
        claimedUntil: null,
      });
      expect(outbox).toMatchObject({
        routingKey: 'credit.settlement-succeeded.v1',
        envelope: {
          eventType: 'CreditSettlementSucceeded',
          publisher: 'credit-service',
          payload: {
            errandId: event.payload.errandId,
            requesterUserId: event.payload.requesterUserId,
            courierUserId: event.payload.courierUserId,
            requesterAmount,
            courierAmount,
            requesterCreditTransactionId: result.requesterTransactionId,
            courierCreditTransactionId: result.courierTransactionId,
          },
        },
      });
      const linkedInbox = await dataSource
        .getRepository(InboxEvent)
        .findBy({ outcomeOperationId: operation.id });
      expect(linkedInbox).toHaveLength(2);
      expect(
        linkedInbox.every(
          (item) =>
            item.outcomeTransactionId === null &&
            item.outcomeOutboxEventId === outbox.eventId,
        ),
      ).toBe(true);
    },
  );

  it.each([
    ['missing reservation', 'RESERVATION_NOT_FOUND'],
    ['released reservation', 'RESERVATION_RELEASED'],
    ['consumed reservation', 'ALREADY_TRANSFERRED'],
    ['requester mismatch', 'RESERVATION_USER_MISMATCH'],
    ['amount mismatch', 'AMOUNT_MISMATCH'],
  ] as const)(
    'commits a %s rejection without financial mutation',
    async (scenario, reason) => {
      const event = command();
      if (scenario !== 'missing reservation') {
        const reservationRequester =
          scenario === 'requester mismatch'
            ? randomUUID()
            : event.payload.requesterUserId;
        const reservedAmount = scenario === 'amount mismatch' ? 60 : 50;
        await createAccount(reservationRequester, 50, reservedAmount);
        if (reservationRequester !== event.payload.requesterUserId) {
          await createAccount(event.payload.requesterUserId, 50, 0);
        }
        await createAccount(event.payload.courierUserId, 10, 0);
        await createReservation(event, {
          requesterUserId: reservationRequester,
          amount: reservedAmount,
          status:
            scenario === 'released reservation'
              ? 'RELEASED'
              : scenario === 'consumed reservation'
                ? 'CONSUMED'
                : 'ACTIVE',
        });
      }
      const { operationId, workerId } = await acceptAndClaim(event);
      const beforeAccounts = await dataSource
        .getRepository(CreditAccount)
        .find({
          order: { userId: 'ASC' },
        });
      const beforeTransactions = await dataSource
        .getRepository(CreditTransaction)
        .count();
      const beforeReservation = await dataSource
        .getRepository(CreditReservation)
        .findOneBy({ errandId: event.payload.errandId });

      const result = await processor.processClaimed(operationId, workerId);

      expect(result).toMatchObject({ status: 'rejected', reason });
      expect(
        await dataSource.getRepository(CreditAccount).find({
          order: { userId: 'ASC' },
        }),
      ).toEqual(beforeAccounts);
      expect(await dataSource.getRepository(CreditTransaction).count()).toBe(
        beforeTransactions,
      );
      expect(
        await dataSource
          .getRepository(CreditReservation)
          .findOneBy({ errandId: event.payload.errandId }),
      ).toEqual(beforeReservation);
      const operation = await dataSource
        .getRepository(CreditOperation)
        .findOneByOrFail({ id: operationId });
      expect(operation).toMatchObject({
        status: 'REJECTED',
        rejectionReason: reason,
        completionTransactionId: null,
        requesterTransactionId: null,
        courierTransactionId: null,
        claimedBy: null,
        claimedUntil: null,
      });
      await expect(
        dataSource
          .getRepository(OutboxEvent)
          .findOneByOrFail({ eventId: operation.outcomeOutboxEventId! }),
      ).resolves.toMatchObject({
        routingKey: 'credit.settlement-rejected.v1',
        envelope: { payload: { rejectionReason: reason } },
      });
    },
  );

  it.each(['missing courier account', 'unsafe requester balance'] as const)(
    'keeps %s as a retryable technical failure',
    async (scenario) => {
      const event = command();
      await createAccount(
        event.payload.requesterUserId,
        50,
        scenario === 'unsafe requester balance' ? 49 : 50,
      );
      if (scenario !== 'missing courier account') {
        await createAccount(event.payload.courierUserId, 10, 0);
      }
      await createReservation(event);
      const { operationId, workerId } = await acceptAndClaim(event);

      await expect(
        processor.processClaimed(operationId, workerId),
      ).rejects.toBeInstanceOf(CreditSettlementExecutionError);

      await expect(
        dataSource
          .getRepository(CreditOperation)
          .findOneByOrFail({ id: operationId }),
      ).resolves.toMatchObject({
        status: 'PENDING',
        requesterTransactionId: null,
        courierTransactionId: null,
        outcomeOutboxEventId: null,
      });
      expect(await dataSource.getRepository(OutboxEvent).count()).toBe(0);
      expect(await dataSource.getRepository(CreditTransaction).count()).toBe(1);
    },
  );

  it('defers while an established transfer is pending', async () => {
    const event = command();
    await createAccount(event.payload.requesterUserId, 50, 50);
    await createAccount(event.payload.courierUserId, 10, 0);
    await createReservation(event);
    const transfer: ErrandCompletedEvent = {
      eventId: randomUUID(),
      eventType: 'ErrandCompleted',
      timestamp: new Date().toISOString(),
      publisher: 'order-service',
      payload: {
        errandId: event.payload.errandId,
        requesterUserId: event.payload.requesterUserId,
        courierUserId: event.payload.courierUserId,
        amount: 50,
      },
    };
    await transferIngress.accept(transfer);
    const { operationId, workerId } = await acceptAndClaim(event);

    await expect(
      processor.processClaimed(operationId, workerId),
    ).rejects.toThrow('waiting for the established transfer operation');

    await expect(
      dataSource
        .getRepository(CreditOperation)
        .findOneByOrFail({ id: operationId }),
    ).resolves.toMatchObject({ status: 'PENDING' });
    expect(await dataSource.getRepository(OutboxEvent).count()).toBe(0);
  });

  it('rolls back balances, ledger, reservation, and operation when outbox persistence fails', async () => {
    const event = command();
    await createAccount(event.payload.requesterUserId, 50, 50);
    await createAccount(event.payload.courierUserId, 10, 0);
    await createReservation(event);
    const { operationId, workerId } = await acceptAndClaim(event);
    await dataSource.query(`
      CREATE FUNCTION reject_test_settlement_outbox()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'injected settlement outbox failure';
      END;
      $$ LANGUAGE plpgsql
    `);
    await dataSource.query(`
      CREATE TRIGGER "TRG_test_reject_settlement_outbox"
      BEFORE INSERT ON "outbox_events"
      FOR EACH ROW
      WHEN (NEW.event_type = 'CreditSettlementSucceeded')
      EXECUTE FUNCTION reject_test_settlement_outbox()
    `);

    try {
      await expect(
        processor.processClaimed(operationId, workerId),
      ).rejects.toThrow('injected settlement outbox failure');
    } finally {
      await dataSource.query(
        'DROP TRIGGER "TRG_test_reject_settlement_outbox" ON "outbox_events"',
      );
      await dataSource.query('DROP FUNCTION reject_test_settlement_outbox()');
    }

    await expect(
      dataSource
        .getRepository(CreditAccount)
        .findOneByOrFail({ userId: event.payload.requesterUserId }),
    ).resolves.toMatchObject({ creditBalance: 50, reservedBalance: 50 });
    await expect(
      dataSource
        .getRepository(CreditAccount)
        .findOneByOrFail({ userId: event.payload.courierUserId }),
    ).resolves.toMatchObject({ creditBalance: 10, reservedBalance: 0 });
    await expect(
      dataSource
        .getRepository(CreditReservation)
        .findOneByOrFail({ errandId: event.payload.errandId }),
    ).resolves.toMatchObject({ status: 'ACTIVE' });
    await expect(
      dataSource
        .getRepository(CreditOperation)
        .findOneByOrFail({ id: operationId }),
    ).resolves.toMatchObject({
      status: 'PENDING',
      requesterTransactionId: null,
      courierTransactionId: null,
      outcomeOutboxEventId: null,
    });
    expect(await dataSource.getRepository(CreditTransaction).count()).toBe(1);
    expect(await dataSource.getRepository(OutboxEvent).count()).toBe(0);
  });

  it('serializes settlement against the normal completion transfer without double movement', async () => {
    const event = command();
    await createAccount(event.payload.requesterUserId, 50, 50);
    await createAccount(event.payload.courierUserId, 10, 0);
    await createReservation(event);
    const transfer: ErrandCompletedEvent = {
      eventId: randomUUID(),
      eventType: 'ErrandCompleted',
      timestamp: new Date().toISOString(),
      publisher: 'order-service',
      payload: {
        errandId: event.payload.errandId,
        requesterUserId: event.payload.requesterUserId,
        courierUserId: event.payload.courierUserId,
        amount: 50,
      },
    };
    const [settlementIngress, transferAccepted] = await Promise.all([
      ingress.accept(event),
      transferIngress.accept(transfer),
    ]);
    if (
      settlementIngress.status !== 'accepted' ||
      transferAccepted.status !== 'accepted'
    ) {
      throw new Error('expected fresh settlement and transfer ingress');
    }
    const workerId = randomUUID();
    await operationStore.claim(workerId, 10, 30_000);

    const [settlementOutcome, transferOutcome] = await Promise.allSettled([
      processor.processClaimed(settlementIngress.operationId, workerId),
      transferProcessor.processClaimed(transferAccepted.operationId, workerId),
    ]);

    expect(transferOutcome).toMatchObject({
      status: 'fulfilled',
      value: { status: 'succeeded' },
    });
    if (settlementOutcome.status === 'fulfilled') {
      expect(settlementOutcome.value).toMatchObject({
        status: 'rejected',
        reason: 'ALREADY_TRANSFERRED',
      });
    } else {
      expect(settlementOutcome.reason).toBeInstanceOf(
        CreditSettlementExecutionError,
      );
    }
    await expect(
      dataSource
        .getRepository(CreditReservation)
        .findOneByOrFail({ errandId: event.payload.errandId }),
    ).resolves.toMatchObject({ status: 'CONSUMED' });
    await expect(
      dataSource
        .getRepository(CreditAccount)
        .findOneByOrFail({ userId: event.payload.requesterUserId }),
    ).resolves.toMatchObject({ creditBalance: 50, reservedBalance: 0 });
    await expect(
      dataSource
        .getRepository(CreditAccount)
        .findOneByOrFail({ userId: event.payload.courierUserId }),
    ).resolves.toMatchObject({ creditBalance: 60, reservedBalance: 0 });
    expect(
      await dataSource
        .getRepository(CreditTransaction)
        .countBy({ type: 'TRANSFER', errandId: event.payload.errandId }),
    ).toBe(1);
    expect(
      await dataSource
        .getRepository(CreditTransaction)
        .countBy({ type: 'RELEASE', errandId: event.payload.errandId }),
    ).toBe(0);
  });

  it('serializes settlement against cancellation release without double movement', async () => {
    const event = command();
    await createAccount(event.payload.requesterUserId, 50, 50);
    await createAccount(event.payload.courierUserId, 10, 0);
    await createReservation(event);
    const [settlementIngress, releaseAccepted] = await Promise.all([
      ingress.accept(event),
      releaseIngress.accept({
        eventId: randomUUID(),
        eventType: 'ErrandCancelled',
        timestamp: new Date().toISOString(),
        publisher: 'order-service',
        payload: { errandId: event.payload.errandId },
      }),
    ]);
    if (
      settlementIngress.status !== 'accepted' ||
      releaseAccepted.status !== 'accepted'
    ) {
      throw new Error('expected fresh settlement and release ingress');
    }
    const workerId = randomUUID();
    await operationStore.claim(workerId, 10, 30_000);

    const outcomes = await Promise.all([
      processor.processClaimed(settlementIngress.operationId, workerId),
      releaseProcessor.processClaimed(releaseAccepted.operationId, workerId),
    ]);

    expect(
      outcomes.filter(({ status }) => status === 'succeeded'),
    ).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === 'rejected')).toHaveLength(
      1,
    );
    const reservation = await dataSource
      .getRepository(CreditReservation)
      .findOneByOrFail({ errandId: event.payload.errandId });
    expect(['CONSUMED', 'RELEASED']).toContain(reservation.status);
    expect(
      await dataSource.getRepository(CreditTransaction).count({
        where: [
          { type: 'RELEASE', errandId: event.payload.errandId },
          { type: 'TRANSFER', errandId: event.payload.errandId },
        ],
      }),
    ).toBe(reservation.status === 'CONSUMED' ? 2 : 1);
    const requester = await dataSource
      .getRepository(CreditAccount)
      .findOneByOrFail({ userId: event.payload.requesterUserId });
    const courier = await dataSource
      .getRepository(CreditAccount)
      .findOneByOrFail({ userId: event.payload.courierUserId });
    expect(requester.reservedBalance).toBe(0);
    expect(
      requester.creditBalance +
        requester.reservedBalance +
        courier.creditBalance +
        courier.reservedBalance,
    ).toBe(110);
  });
});
