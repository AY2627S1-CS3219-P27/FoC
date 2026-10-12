import type pg from 'pg';

// One key for the whole sweep tick (ADR 0003).
export const SWEEP_LOCK_KEY = 321901;

// Only one instance should run the sweep at a time. The lock belongs to a
// single database connection, so lock, run, and unlock all use the same
// client (pool.query() could pick a different one each call). If the lock
// is taken, skip this tick; don't wait.
export async function withAdvisoryLock<T>(
  pool: pg.Pool,
  key: number,
  fn: () => Promise<T>,
): Promise<{ ran: true; value: T } | { ran: false }> {
  const client = await pool.connect();
  // A failed lock or unlock may leave the lock on the session: destroy the
  // client rather than return it to the pool.
  let broken = false;
  try {
    try {
      const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS got', [key]);
      if (!rows[0].got) return { ran: false };
    } catch (e) {
      broken = true;
      throw e;
    }
    try {
      return { ran: true, value: await fn() };
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [key]).catch(() => {
        broken = true;
      });
    }
  } finally {
    client.release(broken);
  }
}
