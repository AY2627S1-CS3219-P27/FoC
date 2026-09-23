import { randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import type { EnvironmentVariables } from '../src/config/environment.js';
import { createDatabaseOptions } from '../src/database/database-options.js';
import { OutboxRelay } from '../src/outbox/outbox.relay.js';
import { OutboxStore } from '../src/outbox/outbox.store.js';
import type { RabbitMqOutboxPublisher } from '../src/outbox/rabbitmq-outbox.publisher.js';

const ROUTING_KEY = 'credit.account-initialised.v1';

describe('Transactional outbox persistence', () => {
  let dataSource: DataSource;
  let store: OutboxStore;

  async function insertOutbox(
    eventId: string,
    createdAt: Date,
    claim?: { workerId: string; until: Date },
  ): Promise<void> {
    await dataSource.query(
      `
        INSERT INTO outbox_events (
          event_id, event_type, routing_key, envelope, created_at,
          attempt_count, claimed_by, claimed_until
        ) VALUES ($1, 'CreditAccountInitialised', $2, $3, $4, 0, $5, $6)
      `,
      [
        eventId,
        ROUTING_KEY,
        { eventId, eventType: 'CreditAccountInitialised' },
        createdAt,
        claim?.workerId ?? null,
        claim?.until ?? null,
      ],
    );
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
    store = new OutboxStore(dataSource);
  });

  beforeEach(async () => {
    await dataSource.query(
      'TRUNCATE TABLE inbox_events, outbox_events, credit_allocations, credit_accounts',
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.undoLastMigration({ transaction: 'all' });
      await dataSource.destroy();
    }
  });

  it('claims by age with the configured limit and increments attempts', async () => {
    const oldest = randomUUID();
    const middle = randomUUID();
    const newest = randomUUID();
    await insertOutbox(newest, new Date('2026-01-03T00:00:00Z'));
    await insertOutbox(oldest, new Date('2026-01-01T00:00:00Z'));
    await insertOutbox(middle, new Date('2026-01-02T00:00:00Z'));

    const claimed = await store.claim('worker-1', 2, 30_000);

    expect(claimed.map(({ eventId }) => eventId)).toEqual([oldest, middle]);
    expect(claimed.map(({ attemptCount }) => attemptCount)).toEqual([1, 1]);
    expect(
      await dataSource.query(
        'SELECT claimed_by, attempt_count FROM outbox_events WHERE event_id = $1',
        [newest],
      ),
    ).toEqual([{ claimed_by: null, attempt_count: 0 }]);
  });

  it('excludes active leases and recovers expired claims', async () => {
    const active = randomUUID();
    const expired = randomUUID();
    await insertOutbox(active, new Date(), {
      workerId: 'active-worker',
      until: new Date(Date.now() + 60_000),
    });
    await insertOutbox(expired, new Date(), {
      workerId: 'dead-worker',
      until: new Date(Date.now() - 1_000),
    });

    const claimed = await store.claim('recovery-worker', 10, 30_000);

    expect(claimed.map(({ eventId }) => eventId)).toEqual([expired]);
    expect(claimed[0].attemptCount).toBe(1);
  });

  it('gives concurrent workers disjoint batches', async () => {
    const ids = Array.from({ length: 6 }, () => randomUUID());
    for (const [index, eventId] of ids.entries()) {
      await insertOutbox(eventId, new Date(Date.now() + index));
    }

    const [first, second] = await Promise.all([
      store.claim('worker-1', 3, 30_000),
      store.claim('worker-2', 3, 30_000),
    ]);
    const firstIds = new Set(first.map(({ eventId }) => eventId));
    const secondIds = new Set(second.map(({ eventId }) => eventId));

    expect(first).toHaveLength(3);
    expect(second).toHaveLength(3);
    expect([...firstIds].some((eventId) => secondIds.has(eventId))).toBe(false);
    expect(new Set([...firstIds, ...secondIds])).toEqual(new Set(ids));
  });

  it('guards completion by worker ownership and retains failure history', async () => {
    const eventId = randomUUID();
    await insertOutbox(eventId, new Date());
    await store.claim('worker-1', 1, 30_000);
    await store.markFailed(eventId, 'worker-1', 'first failure');
    await store.claim('worker-2', 1, 30_000);

    await expect(store.markPublished(eventId, 'worker-1')).resolves.toBe(false);
    await expect(store.markPublished(eventId, 'worker-2')).resolves.toBe(true);
    expect(
      await dataSource.query(
        `
          SELECT published_at IS NOT NULL AS published,
                 claimed_by,
                 claimed_until,
                 attempt_count,
                 last_error
          FROM outbox_events WHERE event_id = $1
        `,
        [eventId],
      ),
    ).toEqual([
      {
        published: true,
        claimed_by: null,
        claimed_until: null,
        attempt_count: 2,
        last_error: 'first failure',
      },
    ]);
  });

  it('discovers a pending row committed before a new relay starts', async () => {
    const eventId = randomUUID();
    await insertOutbox(eventId, new Date());
    const values = {
      OUTBOX_POLL_INTERVAL_MS: 1_000,
      OUTBOX_BATCH_SIZE: 100,
      OUTBOX_CLAIM_LEASE_MS: 30_000,
      OUTBOX_UNPUBLISHED_WARNING_MS: 60_000,
    };
    const config = {
      getOrThrow: (key: keyof typeof values) => values[key],
    } as ConfigService<EnvironmentVariables, true>;
    const publisher = {
      start: vi.fn().mockResolvedValue(undefined),
      publish: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as RabbitMqOutboxPublisher;
    const relay = new OutboxRelay(config, store, publisher);

    await relay.runOnce();

    expect(publisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId,
        routingKey: ROUTING_KEY,
        envelope: { eventId, eventType: 'CreditAccountInitialised' },
      }),
    );
    expect(
      await dataSource.query(
        'SELECT published_at IS NOT NULL AS published FROM outbox_events WHERE event_id = $1',
        [eventId],
      ),
    ).toEqual([{ published: true }]);
  });
});
