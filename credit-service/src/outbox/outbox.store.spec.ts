import type { DataSource } from 'typeorm';
import { OutboxStore } from './outbox.store.js';

describe('OutboxStore', () => {
  it('claims an ordered batch atomically and increments attempts', async () => {
    const rows = [{ eventId: 'event-1' }];
    const query = vi.fn().mockResolvedValue([rows, 1]);
    const store = new OutboxStore({ query } as unknown as DataSource);

    await expect(store.claim('worker-1', 25, 30_000)).resolves.toBe(rows);

    const [sql, parameters] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(sql).toContain('ORDER BY created_at ASC, event_id ASC');
    expect(sql).toContain('published_at IS NULL');
    expect(sql).toContain('claimed_until <= clock_timestamp()');
    expect(sql).toContain('attempt_count = event.attempt_count + 1');
    expect(parameters).toEqual([25, 'worker-1', 30_000]);
  });

  it('marks publication only while the worker still owns the claim', async () => {
    const query = vi.fn().mockResolvedValue([[{ eventId: 'event-1' }], 1]);
    const store = new OutboxStore({ query } as unknown as DataSource);

    await expect(store.markPublished('event-1', 'worker-1')).resolves.toBe(
      true,
    );

    const [sql, parameters] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('published_at = clock_timestamp()');
    expect(sql).toContain('claimed_by = $2');
    expect(sql).toContain('published_at IS NULL');
    expect(sql).not.toContain('last_error = NULL');
    expect(parameters).toEqual(['event-1', 'worker-1']);
  });

  it('releases a failed claim with a guarded, sanitized failure value', async () => {
    const query = vi.fn().mockResolvedValue([[], 0]);
    const store = new OutboxStore({ query } as unknown as DataSource);

    await expect(
      store.markFailed('event-1', 'old-worker', 'stable failure'),
    ).resolves.toBe(false);

    const [sql, parameters] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('last_error = $3');
    expect(sql).toContain('claimed_by = $2');
    expect(parameters).toEqual(['event-1', 'old-worker', 'stable failure']);
  });
});
