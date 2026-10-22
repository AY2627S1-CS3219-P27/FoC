import { randomUUID } from 'node:crypto';
import {
  AccountEventContractValidator,
  type ErrandCancelledEvent,
  type ErrandCompletedEvent,
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
import {
  CreditReleaseExecutionError,
  ReleaseOperationProcessor,
} from '../src/settlement/release-operation.processor.js';
import { ReleaseService } from '../src/settlement/release.service.js';
import { TransferOperationProcessor } from '../src/settlement/transfer-operation.processor.js';
import { TransferService } from '../src/settlement/transfer.service.js';

function cancellation(errandId = randomUUID()): ErrandCancelledEvent {
  return {
    eventId: randomUUID(),
    eventType: 'ErrandCancelled',
    timestamp: new Date().toISOString(),
    publisher: 'order-service',
    payload: { errandId },
  };
}

describe('ReleaseOperationProcessor', () => {
  let dataSource: DataSource;
  let ingress: ReleaseService;
  let processor: ReleaseOperationProcessor;
  let transferIngress: TransferService;
  let transferProcessor: TransferOperationProcessor;
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
    errandId: string,
    requesterUserId: string,
    status: 'ACTIVE' | 'CONSUMED' | 'RELEASED' = 'ACTIVE',
    amount = 25,
  ): Promise<CreditReservation> {
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
        errandId,
      }),
    );
    const reservations = dataSource.getRepository(CreditReservation);
    return reservations.save(
      reservations.create({
        id: randomUUID(),
        errandId,
        requesterUserId,
        reservedAmount: amount,
        status,
        latestTransactionId: reservationTransaction.id,
      }),
    );
  }

  async function createReserveOperation(
    errandId: string,
    requesterUserId: string,
    status: 'PENDING' | 'SUCCEEDED' | 'REJECTED',
    amount = 25,
  ): Promise<CreditOperation> {
    let completionTransactionId: string | null = null;
    let outcomeOutboxEventId: string | null = null;
    if (status !== 'PENDING') {
      outcomeOutboxEventId = randomUUID();
      const outbox = dataSource.getRepository(OutboxEvent);
      await outbox.save(
        outbox.create({
          eventId: outcomeOutboxEventId,
          eventType:
            status === 'SUCCEEDED'
              ? 'CreditReservationSuccess'
              : 'CreditReservationRejected',
          routingKey:
            status === 'SUCCEEDED'
              ? 'credit.reservation-success.v1'
              : 'credit.reservation-rejected.v1',
          envelope: {},
          publishedAt: null,
          attemptCount: 0,
          lastError: null,
          claimedBy: null,
          claimedUntil: null,
        }),
      );
    }
    if (status === 'SUCCEEDED') {
      const transactions = dataSource.getRepository(CreditTransaction);
      const transaction = await transactions.save(
        transactions.create({
          id: randomUUID(),
          type: 'RESERVATION',
          amount,
          originBalanceType: 'CREDIT_BALANCE',
          destinationBalanceType: 'RESERVED_BALANCE',
          originUserId: requesterUserId,
          destinationUserId: requesterUserId,
          errandId,
        }),
      );
      completionTransactionId = transaction.id;
    }
    const operations = dataSource.getRepository(CreditOperation);
    return operations.save(
      operations.create({
        id: randomUUID(),
        errandId,
        operationType: 'RESERVE',
        status,
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
        rejectionReason: status === 'REJECTED' ? 'INSUFFICIENT_CREDITS' : null,
        completionTransactionId,
        outcomeOutboxEventId,
      }),
    );
  }

  async function acceptAndClaim(event: ErrandCancelledEvent): Promise<{
    operationId: string;
    workerId: string;
  }> {
    const accepted = await ingress.accept(event);
    if (accepted.status !== 'accepted') {
      throw new Error('expected fresh release ingress');
    }
    const workerId = randomUUID();
    const claimed = await operationStore.claim(workerId, 10, 30_000);
    expect(claimed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: accepted.operationId,
          operationType: 'RELEASE',
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
    ingress = new ReleaseService(
      transactions,
      new AccountEventContractValidator(),
    );
    processor = new ReleaseOperationProcessor(transactions);
    transferIngress = new TransferService(transactions);
    transferProcessor = new TransferOperationProcessor(transactions);
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

  it('atomically returns the stored reservation and completes every linked inbox', async () => {
    const event = cancellation();
    const requesterUserId = randomUUID();
    await createAccount(requesterUserId, 75, 25);
    await createReservation(event.payload.errandId, requesterUserId);
    const accepted = await ingress.accept(event);
    if (accepted.status !== 'accepted') {
      throw new Error('expected fresh release ingress');
    }
    await expect(
      ingress.accept(cancellation(event.payload.errandId)),
    ).resolves.toMatchObject({
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
      throw new Error('expected successful release');
    }
    const [account, reservation, operation, transaction, outbox] =
      await Promise.all([
        dataSource
          .getRepository(CreditAccount)
          .findOneByOrFail({ userId: requesterUserId }),
        dataSource
          .getRepository(CreditReservation)
          .findOneByOrFail({ errandId: event.payload.errandId }),
        dataSource
          .getRepository(CreditOperation)
          .findOneByOrFail({ id: accepted.operationId }),
        dataSource
          .getRepository(CreditTransaction)
          .findOneByOrFail({ id: result.transactionId }),
        dataSource
          .getRepository(OutboxEvent)
          .findOneByOrFail({ eventId: result.outboxEventId }),
      ]);
    expect(account).toMatchObject({ creditBalance: 100, reservedBalance: 0 });
    expect(account.creditBalance + account.reservedBalance).toBe(100);
    expect(transaction).toMatchObject({
      type: 'RELEASE',
      amount: 25,
      originBalanceType: 'RESERVED_BALANCE',
      destinationBalanceType: 'CREDIT_BALANCE',
      originUserId: requesterUserId,
      destinationUserId: requesterUserId,
      errandId: event.payload.errandId,
    });
    expect(reservation).toMatchObject({
      status: 'RELEASED',
      latestTransactionId: transaction.id,
    });
    expect(operation).toMatchObject({
      status: 'SUCCEEDED',
      completionTransactionId: transaction.id,
      outcomeOutboxEventId: outbox.eventId,
      claimedBy: null,
      claimedUntil: null,
      lastError: null,
    });
    expect(outbox).toMatchObject({
      routingKey: 'credit.release-success.v1',
      envelope: {
        eventType: 'CreditReleaseSuccess',
        timestamp: transaction.createdAt.toISOString(),
        publisher: 'credit-service',
        payload: {
          errandId: event.payload.errandId,
          requesterUserId,
          releasedAmount: 25,
          creditTransactionId: transaction.id,
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
          item.outcomeTransactionId === transaction.id &&
          item.outcomeOutboxEventId === outbox.eventId,
      ),
    ).toBe(true);
  });

  it.each([
    ['rejected reserve', 'RESERVATION_NOT_FOUND'],
    ['consumed reservation', 'ALREADY_TRANSFERRED'],
  ] as const)(
    'commits %s as a no-mutation business rejection',
    async (scenario, reason) => {
      const event = cancellation();
      const requesterUserId = randomUUID();
      await createAccount(
        requesterUserId,
        scenario === 'consumed reservation' ? 75 : 100,
        scenario === 'consumed reservation' ? 25 : 0,
      );
      if (scenario === 'rejected reserve') {
        await createReserveOperation(
          event.payload.errandId,
          requesterUserId,
          'REJECTED',
        );
      } else {
        await createReservation(
          event.payload.errandId,
          requesterUserId,
          'CONSUMED',
        );
      }
      const { operationId, workerId } = await acceptAndClaim(event);
      const beforeAccount = await dataSource
        .getRepository(CreditAccount)
        .findOneByOrFail({ userId: requesterUserId });
      const transactionCount = await dataSource
        .getRepository(CreditTransaction)
        .count();

      await expect(
        processor.processClaimed(operationId, workerId),
      ).resolves.toMatchObject({ status: 'rejected', reason });

      expect(
        await dataSource
          .getRepository(CreditAccount)
          .findOneByOrFail({ userId: requesterUserId }),
      ).toEqual(beforeAccount);
      expect(await dataSource.getRepository(CreditTransaction).count()).toBe(
        transactionCount,
      );
      const operation = await dataSource
        .getRepository(CreditOperation)
        .findOneByOrFail({ id: operationId });
      expect(operation).toMatchObject({
        status: 'REJECTED',
        requesterUserId,
        amount: 25,
        rejectionReason: reason,
        completionTransactionId: null,
        claimedBy: null,
        claimedUntil: null,
      });
      const outbox = await dataSource
        .getRepository(OutboxEvent)
        .findOneByOrFail({ eventId: operation.outcomeOutboxEventId! });
      expect(outbox).toMatchObject({
        routingKey: 'credit.release-rejected.v1',
        envelope: {
          payload: {
            errandId: event.payload.errandId,
            requesterUserId,
            rejectionReason: reason,
          },
        },
      });
    },
  );

  it.each([
    'missing reserve',
    'pending reserve',
    'successful reserve',
  ] as const)(
    'keeps a cancellation with %s and no reservation retryable',
    async (scenario) => {
      const event = cancellation();
      const requesterUserId = randomUUID();
      if (scenario !== 'missing reserve') {
        await createAccount(requesterUserId, 75, 25);
        await createReserveOperation(
          event.payload.errandId,
          requesterUserId,
          scenario === 'pending reserve' ? 'PENDING' : 'SUCCEEDED',
        );
      }
      const { operationId, workerId } = await acceptAndClaim(event);

      await expect(
        processor.processClaimed(operationId, workerId),
      ).rejects.toBeInstanceOf(CreditReleaseExecutionError);

      const operation = await dataSource
        .getRepository(CreditOperation)
        .findOneByOrFail({ id: operationId });
      expect(operation).toMatchObject({
        status: 'PENDING',
        requesterUserId:
          scenario === 'missing reserve' ? null : requesterUserId,
        amount: scenario === 'missing reserve' ? null : 25,
        completionTransactionId: null,
        outcomeOutboxEventId: null,
      });
      expect(
        await dataSource
          .getRepository(OutboxEvent)
          .countBy({ eventType: 'CreditReleaseRejected' }),
      ).toBe(0);
    },
  );

  it('treats a released reservation with a pending operation as an invariant failure', async () => {
    const event = cancellation();
    const requesterUserId = randomUUID();
    await createAccount(requesterUserId, 100, 0);
    const accepted = await ingress.accept(event);
    if (accepted.status !== 'accepted') {
      throw new Error('expected fresh release ingress');
    }
    await createReservation(
      event.payload.errandId,
      requesterUserId,
      'RELEASED',
    );
    const workerId = randomUUID();
    await operationStore.claim(workerId, 10, 30_000);

    await expect(
      processor.processClaimed(accepted.operationId, workerId),
    ).rejects.toBeInstanceOf(CreditReleaseExecutionError);
    await expect(
      dataSource
        .getRepository(CreditOperation)
        .findOneByOrFail({ id: accepted.operationId }),
    ).resolves.toMatchObject({
      status: 'PENDING',
      requesterUserId,
      amount: 25,
      completionTransactionId: null,
      outcomeOutboxEventId: null,
    });
    expect(
      await dataSource.getRepository(CreditTransaction).countBy({
        type: 'RELEASE',
      }),
    ).toBe(0);
  });

  it.each([
    ['increased', 25, 40],
    ['decreased', 25, 10],
  ] as const)(
    'refreshes stale release context and refunds the %s reward in full',
    async (_direction, originalAmount, currentAmount) => {
      const event = cancellation();
      const requesterUserId = randomUUID();
      await createAccount(
        requesterUserId,
        100 - originalAmount,
        originalAmount,
      );
      await createReserveOperation(
        event.payload.errandId,
        requesterUserId,
        'SUCCEEDED',
        originalAmount,
      );
      const reservation = await createReservation(
        event.payload.errandId,
        requesterUserId,
        'ACTIVE',
        originalAmount,
      );
      const accepted = await ingress.accept(event);
      if (accepted.status !== 'accepted') {
        throw new Error('expected fresh release ingress');
      }

      const difference = currentAmount - originalAmount;
      const adjustment = await dataSource
        .getRepository(CreditTransaction)
        .save({
          id: randomUUID(),
          type: 'RESERVATION_ADJUSTMENT',
          amount: Math.abs(difference),
          originBalanceType:
            difference > 0 ? 'CREDIT_BALANCE' : 'RESERVED_BALANCE',
          destinationBalanceType:
            difference > 0 ? 'RESERVED_BALANCE' : 'CREDIT_BALANCE',
          originUserId: requesterUserId,
          destinationUserId: requesterUserId,
          errandId: event.payload.errandId,
        });
      await dataSource.getRepository(CreditAccount).update(
        { userId: requesterUserId },
        {
          creditBalance: 100 - currentAmount,
          reservedBalance: currentAmount,
        },
      );
      await dataSource.getRepository(CreditReservation).update(
        { id: reservation.id },
        {
          reservedAmount: currentAmount,
          latestTransactionId: adjustment.id,
        },
      );

      const workerId = randomUUID();
      await operationStore.claim(workerId, 10, 30_000);
      const result = await processor.processClaimed(
        accepted.operationId,
        workerId,
      );
      expect(result).toMatchObject({ status: 'succeeded' });
      if (result.status !== 'succeeded') {
        throw new Error('expected successful release');
      }

      const [account, releasedReservation, operation, transaction, outbox] =
        await Promise.all([
          dataSource
            .getRepository(CreditAccount)
            .findOneByOrFail({ userId: requesterUserId }),
          dataSource
            .getRepository(CreditReservation)
            .findOneByOrFail({ id: reservation.id }),
          dataSource
            .getRepository(CreditOperation)
            .findOneByOrFail({ id: accepted.operationId }),
          dataSource
            .getRepository(CreditTransaction)
            .findOneByOrFail({ id: result.transactionId }),
          dataSource
            .getRepository(OutboxEvent)
            .findOneByOrFail({ eventId: result.outboxEventId }),
        ]);
      expect(account).toMatchObject({ creditBalance: 100, reservedBalance: 0 });
      expect(releasedReservation).toMatchObject({
        status: 'RELEASED',
        reservedAmount: currentAmount,
        latestTransactionId: transaction.id,
      });
      expect(operation).toMatchObject({
        status: 'SUCCEEDED',
        requesterUserId,
        amount: currentAmount,
        completionTransactionId: transaction.id,
        outcomeOutboxEventId: outbox.eventId,
      });
      expect(transaction).toMatchObject({
        type: 'RELEASE',
        amount: currentAmount,
        originUserId: requesterUserId,
        destinationUserId: requesterUserId,
      });
      expect(outbox).toMatchObject({
        routingKey: 'credit.release-success.v1',
        envelope: {
          payload: {
            errandId: event.payload.errandId,
            requesterUserId,
            releasedAmount: currentAmount,
            creditTransactionId: transaction.id,
          },
        },
      });
    },
  );

  it('rejects a stale claimant and lets another worker recover the release', async () => {
    const event = cancellation();
    const requesterUserId = randomUUID();
    await createAccount(requesterUserId, 75, 25);
    await createReservation(event.payload.errandId, requesterUserId);
    const accepted = await ingress.accept(event);
    if (accepted.status !== 'accepted') {
      throw new Error('expected fresh release ingress');
    }
    const staleWorker = randomUUID();
    const recoveryWorker = randomUUID();
    await operationStore.claim(staleWorker, 10, 30_000);
    await dataSource.query(
      `UPDATE credit_operations
       SET claimed_until = clock_timestamp() - INTERVAL '1 second'
       WHERE id = $1`,
      [accepted.operationId],
    );
    await operationStore.claim(recoveryWorker, 10, 30_000);

    await expect(
      processor.processClaimed(accepted.operationId, staleWorker),
    ).resolves.toEqual({
      status: 'claim-lost',
      operationId: accepted.operationId,
    });
    await expect(
      processor.processClaimed(accepted.operationId, recoveryWorker),
    ).resolves.toMatchObject({ status: 'succeeded' });
    expect(
      await dataSource
        .getRepository(CreditTransaction)
        .countBy({ type: 'RELEASE' }),
    ).toBe(1);
  });

  it('rolls back the entire release when outcome persistence fails', async () => {
    const event = cancellation();
    const requesterUserId = randomUUID();
    await createAccount(requesterUserId, 75, 25);
    await createReservation(event.payload.errandId, requesterUserId);
    const { operationId, workerId } = await acceptAndClaim(event);
    await dataSource.query(`
      CREATE FUNCTION reject_test_release_outbox()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'injected release outbox failure';
      END;
      $$ LANGUAGE plpgsql
    `);
    await dataSource.query(`
      CREATE TRIGGER "TRG_test_reject_release_outbox"
      BEFORE INSERT ON "outbox_events"
      FOR EACH ROW
      WHEN (NEW.event_type = 'CreditReleaseSuccess')
      EXECUTE FUNCTION reject_test_release_outbox()
    `);

    try {
      await expect(
        processor.processClaimed(operationId, workerId),
      ).rejects.toThrow('injected release outbox failure');
    } finally {
      await dataSource.query(
        'DROP TRIGGER "TRG_test_reject_release_outbox" ON "outbox_events"',
      );
      await dataSource.query('DROP FUNCTION reject_test_release_outbox()');
    }

    await expect(
      dataSource
        .getRepository(CreditAccount)
        .findOneByOrFail({ userId: requesterUserId }),
    ).resolves.toMatchObject({ creditBalance: 75, reservedBalance: 25 });
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
      completionTransactionId: null,
      outcomeOutboxEventId: null,
    });
    expect(
      await dataSource
        .getRepository(CreditTransaction)
        .countBy({ type: 'RELEASE' }),
    ).toBe(0);
  });

  it('serializes transfer and release so exactly one settles the reservation', async () => {
    const errandId = randomUUID();
    const requesterUserId = randomUUID();
    const courierUserId = randomUUID();
    await createAccount(requesterUserId, 75, 25);
    await createAccount(courierUserId, 100, 0);
    await createReservation(errandId, requesterUserId);
    const release = await ingress.accept(cancellation(errandId));
    const completed: ErrandCompletedEvent = {
      eventId: randomUUID(),
      eventType: 'ErrandCompleted',
      timestamp: new Date().toISOString(),
      publisher: 'order-service',
      payload: {
        errandId,
        requesterUserId,
        courierUserId,
        amount: 25,
      },
    };
    const transfer = await transferIngress.accept(completed);
    if (release.status !== 'accepted' || transfer.status !== 'accepted') {
      throw new Error('expected fresh settlement ingress');
    }
    const workerId = randomUUID();
    await operationStore.claim(workerId, 10, 30_000);

    const [releaseOutcome, transferOutcome] = await Promise.all([
      processor.processClaimed(release.operationId, workerId),
      transferProcessor.processClaimed(transfer.operationId, workerId),
    ]);

    expect([releaseOutcome.status, transferOutcome.status].sort()).toEqual([
      'rejected',
      'succeeded',
    ]);
    if (releaseOutcome.status === 'succeeded') {
      expect(transferOutcome).toMatchObject({
        status: 'rejected',
        reason: 'RESERVATION_RELEASED',
      });
    } else {
      expect(releaseOutcome).toMatchObject({
        status: 'rejected',
        reason: 'ALREADY_TRANSFERRED',
      });
    }
    expect(
      await dataSource
        .getRepository(CreditTransaction)
        .countBy([{ type: 'RELEASE' }, { type: 'TRANSFER' }]),
    ).toBe(1);
    const accounts = await dataSource.getRepository(CreditAccount).find();
    expect(
      accounts.reduce(
        (total, account) =>
          total + account.creditBalance + account.reservedBalance,
        0,
      ),
    ).toBe(200);
  });
});
