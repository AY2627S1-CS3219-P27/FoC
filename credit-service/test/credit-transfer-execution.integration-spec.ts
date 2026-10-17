import { randomUUID } from 'node:crypto';
import type { ErrandCompletedEvent } from '@foc/contracts';
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
  CreditTransferInvariantError,
  TransferOperationProcessor,
} from '../src/settlement/transfer-operation.processor.js';
import { TransferService } from '../src/settlement/transfer.service.js';

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

describe('TransferOperationProcessor', () => {
  let dataSource: DataSource;
  let ingress: TransferService;
  let processor: TransferOperationProcessor;
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
    event: ErrandCompletedEvent,
    options: {
      amount?: number;
      requesterUserId?: string;
      status?: 'ACTIVE' | 'CONSUMED' | 'RELEASED';
    } = {},
  ): Promise<CreditReservation> {
    const requesterUserId =
      options.requesterUserId ?? event.payload.requesterUserId;
    const amount = options.amount ?? 25;
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

  async function acceptAndClaim(event: ErrandCompletedEvent): Promise<{
    operationId: string;
    workerId: string;
  }> {
    const accepted = await ingress.accept(event);
    if (accepted.status !== 'accepted') {
      throw new Error('expected fresh transfer ingress');
    }
    const workerId = randomUUID();
    const claimed = await operationStore.claim(workerId, 10, 30_000);
    expect(claimed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: accepted.operationId,
          operationType: 'TRANSFER',
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
    ingress = new TransferService(transactions);
    processor = new TransferOperationProcessor(transactions);
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

  it('atomically transfers the stored reservation amount and completes every linked inbox', async () => {
    const event = command({
      payload: {
        errandId: randomUUID(),
        requesterUserId: randomUUID(),
        courierUserId: randomUUID(),
        amount: 999,
      },
    });
    await createAccount(event.payload.requesterUserId, 75, 25);
    await createAccount(event.payload.courierUserId, 100, 0);
    await createReservation(event, { amount: 25 });
    const accepted = await ingress.accept(event);
    if (accepted.status !== 'accepted') {
      throw new Error('expected fresh transfer ingress');
    }
    const replay = command({
      payload: { ...event.payload, amount: 1 },
    });
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
      throw new Error('expected successful transfer');
    }
    const [requester, courier, reservation, operation, transaction, outbox] =
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
          .getRepository(CreditTransaction)
          .findOneByOrFail({ id: result.transactionId }),
        dataSource
          .getRepository(OutboxEvent)
          .findOneByOrFail({ eventId: result.outboxEventId }),
      ]);
    expect(requester).toMatchObject({ creditBalance: 75, reservedBalance: 0 });
    expect(courier).toMatchObject({ creditBalance: 125, reservedBalance: 0 });
    expect(
      requester.creditBalance +
        requester.reservedBalance +
        courier.creditBalance +
        courier.reservedBalance,
    ).toBe(200);
    expect(transaction).toMatchObject({
      type: 'TRANSFER',
      amount: 25,
      originBalanceType: 'RESERVED_BALANCE',
      destinationBalanceType: 'CREDIT_BALANCE',
      originUserId: event.payload.requesterUserId,
      destinationUserId: event.payload.courierUserId,
      errandId: event.payload.errandId,
    });
    expect(reservation).toMatchObject({
      status: 'CONSUMED',
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
      routingKey: 'credit.transfer-succeeded.v1',
      envelope: {
        eventType: 'CreditTransferSucceeded',
        timestamp: transaction.createdAt.toISOString(),
        publisher: 'credit-service',
        payload: {
          errandId: event.payload.errandId,
          requesterUserId: event.payload.requesterUserId,
          courierUserId: event.payload.courierUserId,
          transferredAmount: 25,
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
    ['missing reservation', 'RESERVATION_NOT_FOUND'],
    ['released reservation', 'RESERVATION_RELEASED'],
    ['requester mismatch', 'RESERVATION_USER_MISMATCH'],
  ] as const)(
    'commits a %s business rejection without financial mutation',
    async (scenario, reason) => {
      const event = command();
      if (scenario === 'released reservation') {
        await createAccount(event.payload.requesterUserId, 100, 0);
        await createReservation(event, { status: 'RELEASED' });
      } else if (scenario === 'requester mismatch') {
        const reservationRequester = randomUUID();
        await createAccount(reservationRequester, 75, 25);
        await createReservation(event, {
          requesterUserId: reservationRequester,
        });
      }
      const { operationId, workerId } = await acceptAndClaim(event);
      const beforeAccounts = await dataSource
        .getRepository(CreditAccount)
        .find({
          order: { userId: 'ASC' },
        });
      const transactionCount = await dataSource
        .getRepository(CreditTransaction)
        .count();

      const result = await processor.processClaimed(operationId, workerId);

      expect(result).toMatchObject({ status: 'rejected', reason });
      expect(
        await dataSource.getRepository(CreditAccount).find({
          order: { userId: 'ASC' },
        }),
      ).toEqual(beforeAccounts);
      expect(await dataSource.getRepository(CreditTransaction).count()).toBe(
        transactionCount,
      );
      const operation = await dataSource
        .getRepository(CreditOperation)
        .findOneByOrFail({ id: operationId });
      expect(operation).toMatchObject({
        status: 'REJECTED',
        rejectionReason: reason,
        completionTransactionId: null,
        claimedBy: null,
        claimedUntil: null,
      });
      const outbox = await dataSource
        .getRepository(OutboxEvent)
        .findOneByOrFail({ eventId: operation.outcomeOutboxEventId! });
      expect(outbox).toMatchObject({
        routingKey: 'credit.transfer-rejected.v1',
        envelope: {
          payload: {
            errandId: event.payload.errandId,
            requesterUserId: event.payload.requesterUserId,
            courierUserId: event.payload.courierUserId,
            rejectionReason: reason,
          },
        },
      });
    },
  );

  it.each(['missing courier account', 'consumed reservation'] as const)(
    'keeps %s as a retryable invariant failure',
    async (scenario) => {
      const event = command();
      await createAccount(event.payload.requesterUserId, 75, 25);
      if (scenario !== 'missing courier account') {
        await createAccount(event.payload.courierUserId, 100, 0);
      }
      await createReservation(event, {
        status: scenario === 'consumed reservation' ? 'CONSUMED' : 'ACTIVE',
      });
      const { operationId, workerId } = await acceptAndClaim(event);

      await expect(
        processor.processClaimed(operationId, workerId),
      ).rejects.toBeInstanceOf(CreditTransferInvariantError);

      await expect(
        dataSource
          .getRepository(CreditOperation)
          .findOneByOrFail({ id: operationId }),
      ).resolves.toMatchObject({
        status: 'PENDING',
        outcomeOutboxEventId: null,
        completionTransactionId: null,
      });
      expect(await dataSource.getRepository(OutboxEvent).count()).toBe(0);
      expect(await dataSource.getRepository(CreditTransaction).count()).toBe(1);
    },
  );

  it('rejects a stale claimant and lets another worker recover the transfer', async () => {
    const event = command();
    await createAccount(event.payload.requesterUserId, 75, 25);
    await createAccount(event.payload.courierUserId, 100, 0);
    await createReservation(event);
    const accepted = await ingress.accept(event);
    if (accepted.status !== 'accepted') {
      throw new Error('expected fresh transfer ingress');
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
        .countBy({ type: 'TRANSFER' }),
    ).toBe(1);
  });

  it('rolls back the entire movement when outcome persistence fails', async () => {
    const event = command();
    await createAccount(event.payload.requesterUserId, 75, 25);
    await createAccount(event.payload.courierUserId, 100, 0);
    await createReservation(event);
    const { operationId, workerId } = await acceptAndClaim(event);
    await dataSource.query(`
      CREATE FUNCTION reject_test_transfer_outbox()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'injected transfer outbox failure';
      END;
      $$ LANGUAGE plpgsql
    `);
    await dataSource.query(`
      CREATE TRIGGER "TRG_test_reject_transfer_outbox"
      BEFORE INSERT ON "outbox_events"
      FOR EACH ROW
      WHEN (NEW.event_type = 'CreditTransferSucceeded')
      EXECUTE FUNCTION reject_test_transfer_outbox()
    `);

    try {
      await expect(
        processor.processClaimed(operationId, workerId),
      ).rejects.toThrow('injected transfer outbox failure');
    } finally {
      await dataSource.query(
        'DROP TRIGGER "TRG_test_reject_transfer_outbox" ON "outbox_events"',
      );
      await dataSource.query('DROP FUNCTION reject_test_transfer_outbox()');
    }

    await expect(
      dataSource
        .getRepository(CreditAccount)
        .findOneByOrFail({ userId: event.payload.requesterUserId }),
    ).resolves.toMatchObject({ creditBalance: 75, reservedBalance: 25 });
    await expect(
      dataSource
        .getRepository(CreditAccount)
        .findOneByOrFail({ userId: event.payload.courierUserId }),
    ).resolves.toMatchObject({ creditBalance: 100, reservedBalance: 0 });
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
    expect(await dataSource.getRepository(CreditTransaction).count()).toBe(1);
    expect(await dataSource.getRepository(OutboxEvent).count()).toBe(0);
  });

  it('settles opposing transfers without deadlock or lost updates', async () => {
    const firstUser = randomUUID();
    const secondUser = randomUUID();
    await createAccount(firstUser, 75, 25);
    await createAccount(secondUser, 75, 25);
    const first = command({
      payload: {
        errandId: randomUUID(),
        requesterUserId: firstUser,
        courierUserId: secondUser,
        amount: 25,
      },
    });
    const second = command({
      payload: {
        errandId: randomUUID(),
        requesterUserId: secondUser,
        courierUserId: firstUser,
        amount: 25,
      },
    });
    await createReservation(first);
    await createReservation(second);
    const [firstIngress, secondIngress] = await Promise.all([
      ingress.accept(first),
      ingress.accept(second),
    ]);
    if (
      firstIngress.status !== 'accepted' ||
      secondIngress.status !== 'accepted'
    ) {
      throw new Error('expected fresh transfer ingress');
    }
    const workerId = randomUUID();
    await operationStore.claim(workerId, 10, 30_000);

    const outcomes = await Promise.all([
      processor.processClaimed(firstIngress.operationId, workerId),
      processor.processClaimed(secondIngress.operationId, workerId),
    ]);

    expect(outcomes.map(({ status }) => status)).toEqual([
      'succeeded',
      'succeeded',
    ]);
    const accounts = await dataSource.getRepository(CreditAccount).find();
    expect(accounts).toHaveLength(2);
    expect(
      accounts.every(
        (account) =>
          account.creditBalance === 100 && account.reservedBalance === 0,
      ),
    ).toBe(true);
    expect(
      await dataSource
        .getRepository(CreditTransaction)
        .countBy({ type: 'TRANSFER' }),
    ).toBe(2);
  });
});
