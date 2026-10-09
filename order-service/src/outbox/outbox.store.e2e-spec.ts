import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { createTestDb } from '../../test/db.js';
import { outboxEvents } from '../db/schema.js';
import { enqueueOutbox, OutboxStore } from './outbox.store.js';

let t: Awaited<ReturnType<typeof createTestDb>>;
let store: OutboxStore;
beforeAll(async () => {
  t = await createTestDb();
  store = new OutboxStore(t.db);
});
afterAll(() => t.close());
beforeEach(() => t.db.delete(outboxEvents));

const event = () => ({
  eventId: randomUUID(),
  eventType: 'Test',
  routingKey: 'order.test.v1',
  envelope: { hello: 'world' },
});
const row = async (id: string) =>
  (
    await t.db.select().from(outboxEvents).where(eq(outboxEvents.eventId, id))
  )[0];

describe('enqueueOutbox', () => {
  it('commits with the transaction', async () => {
    const e = event();
    await t.db.transaction((tx) => enqueueOutbox(tx, e));
    expect((await row(e.eventId))?.envelope).toEqual(e.envelope);
  });

  it('rolls back with the transaction', async () => {
    const e = event();
    await t.db
      .transaction(async (tx) => {
        await enqueueOutbox(tx, e);
        throw new Error('boom');
      })
      .catch(() => undefined);
    expect(await row(e.eventId)).toBeUndefined();
  });
});

describe('OutboxStore', () => {
  it('claims once, then reclaims after the lease expires', async () => {
    const e = event();
    await enqueueOutbox(t.db, e);

    const first = await store.claim('a', 10, 60_000);
    expect(first.map((c) => c.eventId)).toEqual([e.eventId]);
    expect(first[0]).toMatchObject({ attemptCount: 1, envelope: e.envelope });
    expect(await store.claim('b', 10, 60_000)).toEqual([]);

    await t.db.execute(
      sql`UPDATE outbox_events SET claimed_until = now() - interval '1 second'`,
    );
    const again = await store.claim('b', 10, 60_000);
    expect(again[0]).toMatchObject({ eventId: e.eventId, attemptCount: 2 });
  });

  it('SKIP LOCKED: concurrent claims never share a row', async () => {
    for (let i = 0; i < 20; i++) await enqueueOutbox(t.db, event());
    const [a, b] = await Promise.all([
      store.claim('a', 20, 60_000),
      store.claim('b', 20, 60_000),
    ]);
    const ids = [...a, ...b].map((c) => c.eventId);
    expect(ids).toHaveLength(20);
    expect(new Set(ids).size).toBe(20);
  });

  it('only the claim holder can mark published; published is never reclaimed', async () => {
    const e = event();
    await enqueueOutbox(t.db, e);
    await store.claim('a', 1, 60_000);

    expect(await store.markPublished(e.eventId, 'b')).toBe(false);
    expect(await store.markPublished(e.eventId, 'a')).toBe(true);
    expect((await row(e.eventId))?.publishedAt).not.toBeNull();
    expect(await store.markPublished(e.eventId, 'a')).toBe(false);

    await t.db.execute(sql`UPDATE outbox_events SET claimed_until = NULL`);
    expect(await store.claim('c', 10, 60_000)).toEqual([]);
  });

  it('markFailed releases the claim and delays the retry', async () => {
    const e = event();
    await enqueueOutbox(t.db, e);
    await store.claim('a', 1, 60_000);

    expect(await store.markFailed(e.eventId, 'b', 'x', 60_000)).toBe(false);
    expect(await store.markFailed(e.eventId, 'a', 'nack', 60_000)).toBe(true);
    expect(await row(e.eventId)).toMatchObject({
      lastError: 'nack',
      claimedBy: null,
    });
    expect(await store.claim('a', 1, 60_000)).toEqual([]); // backoff not elapsed

    await t.db.execute(sql`UPDATE outbox_events SET next_attempt_at = now()`);
    expect(await store.claim('a', 1, 60_000)).toHaveLength(1);
  });
});
