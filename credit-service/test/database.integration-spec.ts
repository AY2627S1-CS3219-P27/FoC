import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { createDatabaseOptions } from '../src/database/database-options.js';
import {
  CreditAccount,
  CreditAllocation,
  CreditReservation,
  CreditTransaction,
  InboxEvent,
  OutboxEvent,
} from '../src/database/entities/index.js';

describe('credit persistence migration', () => {
  let dataSource: DataSource;
  let migrationReverted = false;

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
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      if (!migrationReverted) {
        await dataSource.undoLastMigration({ transaction: 'all' });
      }
      await dataSource.destroy();
    }
  });

  it('creates all tables, foreign keys, checks, indexes, and immutability triggers', async () => {
    const tables = await dataSource.query<{ table_name: string }[]>(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
    `);
    expect(tables.map(({ table_name }) => table_name)).toEqual(
      expect.arrayContaining([
        'credit_accounts',
        'credit_allocations',
        'credit_reservations',
        'credit_transactions',
        'inbox_events',
        'outbox_events',
      ]),
    );

    const userIdColumns = await dataSource.query<
      { table_name: string; data_type: string }[]
    >(`
      SELECT table_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('credit_accounts', 'credit_allocations')
        AND column_name = 'user_id'
      ORDER BY table_name
    `);
    expect(userIdColumns).toEqual([
      { table_name: 'credit_accounts', data_type: 'uuid' },
      { table_name: 'credit_allocations', data_type: 'uuid' },
    ]);

    const constraints = await dataSource.query<{ conname: string }[]>(`
      SELECT conname FROM pg_constraint
      WHERE conname LIKE 'CHK_credit_%'
         OR conname LIKE 'CHK_inbox_%'
         OR conname LIKE 'FK_credit_%'
         OR conname LIKE 'FK_inbox_%'
         OR conname = 'CHK_outbox_events_attempt_count'
    `);
    expect(constraints.map(({ conname }) => conname)).toEqual(
      expect.arrayContaining([
        'CHK_credit_accounts_credit_balance',
        'CHK_credit_accounts_reserved_balance',
        'CHK_credit_allocations_amount',
        'CHK_credit_reservations_reserved_amount',
        'CHK_credit_reservations_status',
        'CHK_credit_transactions_amount',
        'CHK_credit_transactions_type',
        'CHK_credit_transactions_origin_balance_type',
        'CHK_credit_transactions_destination_balance_type',
        'CHK_credit_transactions_distinct_balance_types',
        'CHK_credit_transactions_user_relationship',
        'CHK_credit_transactions_direction',
        'CHK_inbox_events_has_outcome',
        'CHK_outbox_events_attempt_count',
        'FK_credit_allocations_user',
        'FK_credit_reservations_requester',
        'FK_credit_reservations_latest_transaction',
        'FK_credit_transactions_origin_user',
        'FK_credit_transactions_destination_user',
        'FK_inbox_events_outcome',
        'FK_inbox_events_outcome_transaction',
        'FK_inbox_events_outcome_outbox',
      ]),
    );

    const indexes = await dataSource.query<{ indexname: string }[]>(`
      SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
    `);
    expect(indexes.map(({ indexname }) => indexname)).toEqual(
      expect.arrayContaining([
        'UQ_credit_allocations_user',
        'UQ_credit_reservations_errand',
        'UQ_credit_reservations_latest_transaction',
        'IDX_credit_reservations_active_requester',
        'IDX_credit_transactions_errand_created_at_id',
        'IDX_credit_transactions_origin_user_created_at_id',
        'IDX_credit_transactions_destination_user_created_at_id',
        'IDX_outbox_events_unpublished_next_attempt_at_created_at',
      ]),
    );

    const outboxColumns = await dataSource.query<{ column_name: string }[]>(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'outbox_events'
    `);
    expect(outboxColumns.map(({ column_name }) => column_name)).toContain(
      'next_attempt_at',
    );

    const triggers = await dataSource.query<
      { event_object_table: string; trigger_name: string }[]
    >(`
      SELECT event_object_table, trigger_name FROM information_schema.triggers
      WHERE event_object_table IN ('credit_allocations', 'credit_transactions')
    `);
    expect(triggers).toEqual(
      expect.arrayContaining([
        {
          event_object_table: 'credit_allocations',
          trigger_name: 'TRG_credit_allocations_immutable',
        },
        {
          event_object_table: 'credit_transactions',
          trigger_name: 'TRG_credit_transactions_immutable',
        },
      ]),
    );
  });

  it('enforces account, allocation, inbox, and outbox constraints', async () => {
    const userId = randomUUID();
    const allocationId = randomUUID();

    await expect(
      dataSource.query(
        `INSERT INTO credit_accounts (user_id, credit_balance, reserved_balance)
         VALUES ($1, -1, 0)`,
        [randomUUID()],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      dataSource.query(
        `INSERT INTO credit_accounts (user_id, credit_balance, reserved_balance)
         VALUES ($1, 0, -1)`,
        [randomUUID()],
      ),
    ).rejects.toMatchObject({ code: '23514' });

    await dataSource.query(
      `INSERT INTO credit_accounts (user_id, credit_balance, reserved_balance)
       VALUES ($1, 100, 0)`,
      [userId],
    );
    await expect(
      dataSource.query(
        `INSERT INTO credit_allocations (id, amount, user_id)
         VALUES ($1, 0, $2)`,
        [randomUUID(), userId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await dataSource.query(
      `INSERT INTO credit_allocations (id, amount, user_id)
       VALUES ($1, 100, $2)`,
      [allocationId, userId],
    );
    await expect(
      dataSource.query(
        `INSERT INTO credit_allocations (id, amount, user_id)
         VALUES ($1, 100, $2)`,
        [randomUUID(), userId],
      ),
    ).rejects.toMatchObject({ code: '23505' });

    const eventId = randomUUID();
    await dataSource.query(
      `INSERT INTO inbox_events
       (event_id, event_type, payload_hash, processed_at, outcome_allocation_id)
       VALUES ($1, 'UserRegistered', $2, now(), $3)`,
      [eventId, 'a'.repeat(64), allocationId],
    );
    await expect(
      dataSource.query(
        `INSERT INTO inbox_events
         (event_id, event_type, payload_hash, processed_at, outcome_allocation_id)
         VALUES ($1, 'UserRegistered', $2, now(), $3)`,
        [eventId, 'b'.repeat(64), allocationId],
      ),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      dataSource.query(
        `INSERT INTO outbox_events
         (event_id, event_type, routing_key, envelope, attempt_count)
         VALUES ($1, 'CreditAccountInitialised', 'credit.account-initialised.v1', '{}', -1)`,
        [randomUUID()],
      ),
    ).rejects.toMatchObject({ code: '23514' });

    await expect(
      dataSource.query(
        `INSERT INTO inbox_events
         (event_id, event_type, payload_hash, processed_at)
         VALUES ($1, 'CreditReservationRejected', $2, now())`,
        [randomUUID(), 'c'.repeat(64)],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('enforces reservation and transaction constraints', async () => {
    const userId = randomUUID();
    const otherUserId = randomUUID();
    const errandId = randomUUID();
    const transactionId = randomUUID();

    await dataSource.query(
      `INSERT INTO credit_accounts (user_id, credit_balance, reserved_balance)
       VALUES ($1, 75, 25), ($2, 100, 0)`,
      [userId, otherUserId],
    );

    await expect(
      dataSource.query(
        `INSERT INTO credit_transactions
         (id, type, amount, origin_balance_type, destination_balance_type,
          origin_user_id, destination_user_id, errand_id)
         VALUES ($1, 'INITIAL_ALLOCATION', 25, 'CREDIT_BALANCE', 'RESERVED_BALANCE', $2, $2, $3)`,
        [randomUUID(), userId, errandId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      dataSource.query(
        `INSERT INTO credit_transactions
         (id, type, amount, origin_balance_type, destination_balance_type,
          origin_user_id, destination_user_id, errand_id)
         VALUES ($1, 'RESERVATION', 0, 'CREDIT_BALANCE', 'RESERVED_BALANCE', $2, $2, $3)`,
        [randomUUID(), userId, errandId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      dataSource.query(
        `INSERT INTO credit_transactions
         (id, type, amount, origin_balance_type, destination_balance_type,
          origin_user_id, destination_user_id, errand_id)
         VALUES ($1, 'RESERVATION', 25, 'RESERVED_BALANCE', 'CREDIT_BALANCE', $2, $2, $3)`,
        [randomUUID(), userId, errandId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      dataSource.query(
        `INSERT INTO credit_transactions
         (id, type, amount, origin_balance_type, destination_balance_type,
          origin_user_id, destination_user_id, errand_id)
         VALUES ($1, 'TRANSFER', 25, 'RESERVED_BALANCE', 'CREDIT_BALANCE', $2, $2, $3)`,
        [randomUUID(), userId, errandId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      dataSource.query(
        `INSERT INTO credit_transactions
         (id, type, amount, origin_balance_type, destination_balance_type,
          origin_user_id, destination_user_id, errand_id)
         VALUES ($1, 'RELEASE', 25, 'RESERVED_BALANCE', 'CREDIT_BALANCE', $2, $3, $4)`,
        [randomUUID(), userId, otherUserId, errandId],
      ),
    ).rejects.toMatchObject({ code: '23514' });

    await dataSource.query(
      `INSERT INTO credit_transactions
       (id, type, amount, origin_balance_type, destination_balance_type,
        origin_user_id, destination_user_id, errand_id)
       VALUES ($1, 'RESERVATION', 25, 'CREDIT_BALANCE', 'RESERVED_BALANCE', $2, $2, $3)`,
      [transactionId, userId, errandId],
    );
    await dataSource.query(
      `INSERT INTO credit_transactions
       (id, type, amount, origin_balance_type, destination_balance_type,
        origin_user_id, destination_user_id, errand_id)
       VALUES
         ($1, 'TRANSFER', 25, 'RESERVED_BALANCE', 'CREDIT_BALANCE', $3, $4, $2),
         ($5, 'RELEASE', 10, 'RESERVED_BALANCE', 'CREDIT_BALANCE', $3, $3, $6)`,
      [
        randomUUID(),
        randomUUID(),
        userId,
        otherUserId,
        randomUUID(),
        randomUUID(),
      ],
    );
    await expect(
      dataSource.query(
        `INSERT INTO credit_reservations
         (id, errand_id, requester_user_id, reserved_amount, status, latest_transaction_id)
         VALUES ($1, $2, $3, 0, 'ACTIVE', $4)`,
        [randomUUID(), errandId, userId, transactionId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      dataSource.query(
        `INSERT INTO credit_reservations
         (id, errand_id, requester_user_id, reserved_amount, status, latest_transaction_id)
         VALUES ($1, $2, $3, 25, 'UNKNOWN', $4)`,
        [randomUUID(), errandId, userId, transactionId],
      ),
    ).rejects.toMatchObject({ code: '23514' });

    await dataSource.query(
      `INSERT INTO credit_reservations
       (id, errand_id, requester_user_id, reserved_amount, status, latest_transaction_id)
       VALUES ($1, $2, $3, 25, 'ACTIVE', $4)`,
      [randomUUID(), errandId, userId, transactionId],
    );
    await expect(
      dataSource.query(
        `INSERT INTO credit_reservations
         (id, errand_id, requester_user_id, reserved_amount, status, latest_transaction_id)
         VALUES ($1, $2, $3, 25, 'ACTIVE', $4)`,
        [randomUUID(), errandId, userId, transactionId],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('rejects updates and deletes from immutable allocations', async () => {
    const [{ id }] = await dataSource.query<{ id: string }[]>(
      'SELECT id FROM credit_allocations LIMIT 1',
    );
    await expect(
      dataSource.query(
        'UPDATE credit_allocations SET amount = 101 WHERE id = $1',
        [id],
      ),
    ).rejects.toThrow('credit_allocations is append-only');
    await expect(
      dataSource.query('DELETE FROM credit_allocations WHERE id = $1', [id]),
    ).rejects.toThrow('credit_allocations is append-only');
  });

  it('rejects updates and deletes from immutable credit transactions', async () => {
    const [{ id }] = await dataSource.query<{ id: string }[]>(
      'SELECT id FROM credit_transactions LIMIT 1',
    );
    await expect(
      dataSource.query(
        'UPDATE credit_transactions SET amount = amount + 1 WHERE id = $1',
        [id],
      ),
    ).rejects.toThrow('credit_transactions is append-only');
    await expect(
      dataSource.query('DELETE FROM credit_transactions WHERE id = $1', [id]),
    ).rejects.toThrow('credit_transactions is append-only');
  });

  it('round-trips reservations, transactions, and generalized inbox outcomes', async () => {
    const userId = randomUUID();
    const courierUserId = randomUUID();
    const errandId = randomUUID();
    const transactionId = randomUUID();
    const transferTransactionId = randomUUID();
    const reservationId = randomUUID();
    const outboxEventId = randomUUID();
    const inboxEventId = randomUUID();
    const accounts = dataSource.getRepository(CreditAccount);
    const transactions = dataSource.getRepository(CreditTransaction);
    const reservations = dataSource.getRepository(CreditReservation);
    const outbox = dataSource.getRepository(OutboxEvent);
    const inbox = dataSource.getRepository(InboxEvent);

    await accounts.save([
      accounts.create({ userId, creditBalance: 60, reservedBalance: 40 }),
      accounts.create({
        userId: courierUserId,
        creditBalance: 100,
        reservedBalance: 0,
      }),
    ]);
    await transactions.save(
      transactions.create({
        id: transactionId,
        type: 'RESERVATION',
        amount: 40,
        originBalanceType: 'CREDIT_BALANCE',
        destinationBalanceType: 'RESERVED_BALANCE',
        originUserId: userId,
        destinationUserId: userId,
        errandId,
      }),
    );
    await transactions.save(
      transactions.create({
        id: transferTransactionId,
        type: 'TRANSFER',
        amount: 40,
        originBalanceType: 'RESERVED_BALANCE',
        destinationBalanceType: 'CREDIT_BALANCE',
        originUserId: userId,
        destinationUserId: courierUserId,
        errandId: randomUUID(),
      }),
    );
    await reservations.save(
      reservations.create({
        id: reservationId,
        errandId,
        requesterUserId: userId,
        reservedAmount: 40,
        status: 'ACTIVE',
        latestTransactionId: transactionId,
      }),
    );
    await outbox.save(
      outbox.create({
        eventId: outboxEventId,
        eventType: 'CreditReservationSuccess',
        routingKey: 'credit.reservation-success.v1',
        envelope: { eventId: outboxEventId },
        publishedAt: null,
        attemptCount: 0,
        lastError: null,
        claimedBy: null,
        claimedUntil: null,
      }),
    );
    await inbox.save(
      inbox.create({
        eventId: inboxEventId,
        eventType: 'CreditReservation',
        payloadHash: 'd'.repeat(64),
        processedAt: new Date(),
        outcomeAllocationId: null,
        outcomeTransactionId: transactionId,
        outcomeOutboxEventId: outboxEventId,
      }),
    );

    await expect(
      transactions.findOneByOrFail({ id: transactionId }),
    ).resolves.toMatchObject({
      amount: 40,
      originBalanceType: 'CREDIT_BALANCE',
      destinationBalanceType: 'RESERVED_BALANCE',
      originUserId: userId,
      destinationUserId: userId,
      errandId,
    });
    await expect(
      transactions.findOneByOrFail({ id: transferTransactionId }),
    ).resolves.toMatchObject({
      type: 'TRANSFER',
      originBalanceType: 'RESERVED_BALANCE',
      destinationBalanceType: 'CREDIT_BALANCE',
      originUserId: userId,
      destinationUserId: courierUserId,
    });
    await expect(
      reservations.findOneByOrFail({ id: reservationId }),
    ).resolves.toMatchObject({
      reservedAmount: 40,
      status: 'ACTIVE',
      latestTransactionId: transactionId,
    });
    await expect(
      inbox.findOneByOrFail({ eventId: inboxEventId }),
    ).resolves.toMatchObject({
      outcomeAllocationId: null,
      outcomeTransactionId: transactionId,
      outcomeOutboxEventId: outboxEventId,
    });
  });

  it('round-trips safe BIGINT and JSONB values through repositories', async () => {
    const userId = randomUUID();
    const allocationId = randomUUID();
    const inboxEventId = randomUUID();
    const outboxEventId = randomUUID();
    const accounts = dataSource.getRepository(CreditAccount);
    const allocations = dataSource.getRepository(CreditAllocation);
    const inbox = dataSource.getRepository(InboxEvent);
    const outbox = dataSource.getRepository(OutboxEvent);

    await accounts.save(
      accounts.create({ userId, creditBalance: 250, reservedBalance: 0 }),
    );
    await allocations.save(
      allocations.create({
        id: allocationId,
        amount: 250,
        userId,
      }),
    );
    await inbox.save(
      inbox.create({
        eventId: inboxEventId,
        eventType: 'UserRegistered',
        payloadHash: 'c'.repeat(64),
        processedAt: new Date(),
        outcomeAllocationId: allocationId,
      }),
    );
    const envelope = { eventId: outboxEventId, payload: { userId } };
    await outbox.save(
      outbox.create({
        eventId: outboxEventId,
        eventType: 'CreditAccountInitialised',
        routingKey: 'credit.account-initialised.v1',
        envelope,
        publishedAt: null,
        attemptCount: 0,
        lastError: null,
        claimedBy: null,
        claimedUntil: null,
      }),
    );

    await expect(accounts.findOneByOrFail({ userId })).resolves.toMatchObject({
      creditBalance: 250,
      reservedBalance: 0,
    });
    await expect(
      allocations.findOneByOrFail({ id: allocationId }),
    ).resolves.toMatchObject({ amount: 250, userId });
    await expect(
      outbox.findOneByOrFail({ eventId: outboxEventId }),
    ).resolves.toMatchObject({ envelope });
  });

  it('reverts the schema cleanly', async () => {
    await dataSource.query(
      'TRUNCATE TABLE inbox_events, credit_reservations, credit_transactions, outbox_events, credit_allocations, credit_accounts',
    );
    await dataSource.undoLastMigration({ transaction: 'all' });
    await dataSource.undoLastMigration({ transaction: 'all' });
    migrationReverted = true;

    const tables = await dataSource.query<{ table_name: string }[]>(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (
          'credit_accounts',
          'credit_allocations',
          'credit_reservations',
          'credit_transactions',
          'inbox_events',
          'outbox_events'
        )
    `);
    expect(tables).toEqual([]);
  });
});
