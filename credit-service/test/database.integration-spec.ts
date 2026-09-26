import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { createDatabaseOptions } from '../src/database/database-options.js';
import {
  CreditAccount,
  CreditAllocation,
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

  it('creates all tables, foreign keys, checks, indexes, and the allocation trigger', async () => {
    const tables = await dataSource.query<{ table_name: string }[]>(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
    `);
    expect(tables.map(({ table_name }) => table_name)).toEqual(
      expect.arrayContaining([
        'credit_accounts',
        'credit_allocations',
        'inbox_events',
        'outbox_events',
      ]),
    );

    const constraints = await dataSource.query<{ conname: string }[]>(`
      SELECT conname FROM pg_constraint
      WHERE conname LIKE 'CHK_credit_%'
         OR conname LIKE 'FK_credit_%'
         OR conname LIKE 'FK_inbox_%'
         OR conname = 'CHK_outbox_events_attempt_count'
    `);
    expect(constraints.map(({ conname }) => conname)).toEqual(
      expect.arrayContaining([
        'CHK_credit_accounts_credit_balance',
        'CHK_credit_accounts_reserved_balance',
        'CHK_credit_allocations_amount',
        'CHK_outbox_events_attempt_count',
        'FK_credit_allocations_user',
        'FK_inbox_events_outcome',
      ]),
    );

    const indexes = await dataSource.query<{ indexname: string }[]>(`
      SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
    `);
    expect(indexes.map(({ indexname }) => indexname)).toEqual(
      expect.arrayContaining([
        'UQ_credit_allocations_user',
        'IDX_outbox_events_unpublished_created_at',
      ]),
    );

    const triggers = await dataSource.query<{ trigger_name: string }[]>(`
      SELECT trigger_name FROM information_schema.triggers
      WHERE event_object_table = 'credit_allocations'
    `);
    expect(triggers.map(({ trigger_name }) => trigger_name)).toContain(
      'TRG_credit_allocations_immutable',
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
    await dataSource.undoLastMigration({ transaction: 'all' });
    migrationReverted = true;

    const tables = await dataSource.query<{ table_name: string }[]>(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('credit_accounts', 'credit_allocations', 'inbox_events', 'outbox_events')
    `);
    expect(tables).toEqual([]);
  });
});
