import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { createDatabaseOptions } from '../src/database/database-options.js';
import {
  IdempotencyService,
  type StoredOutcome,
} from '../src/idempotency/idempotency.service.js';

const USER = '42424242-4242-4242-8242-424242424242';
const OTHER_USER = '43434343-4343-4343-8343-434343434343';
const FINGERPRINT = 'a'.repeat(64);
const OTHER_FINGERPRINT = 'b'.repeat(64);

const outcome: StoredOutcome = {
  statusCode: 201,
  headers: { Location: '/suppliers/1', ETag: '"1"' },
  body: {
    id: 'abc',
    name: 'Cool Spot',
    createdAt: '2026-11-04T10:00:00.000Z',
    categories: [{ id: 'c1', name: 'Food' }],
    brand: null,
  },
};

describe('idempotency keys (real PostgreSQL, F14.2)', () => {
  let dataSource: DataSource;
  let service: IdempotencyService;

  beforeAll(async () => {
    dataSource = new DataSource(
      createDatabaseOptions({
        DB_HOST: process.env.DB_HOST!,
        DB_PORT: Number(process.env.DB_PORT),
        DB_USERNAME: process.env.DB_USERNAME!,
        DB_DATABASE: process.env.DB_DATABASE!,
        DB_PASSWORD_FILE: process.env.DB_PASSWORD_FILE!,
        DB_MIGRATIONS_RUN: false,
      }),
    );
    await dataSource.initialize();
    await dataSource.dropDatabase();
    await dataSource.runMigrations({ transaction: 'all' });
    service = new IdempotencyService(dataSource);
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    await dataSource.query(`TRUNCATE idempotency_keys`);
  });

  const claim = async (key = 'k1', user = USER, fingerprint = FINGERPRINT) => {
    const begun = await service.begin(user, key, fingerprint);
    if (begun.kind !== 'run') {
      throw new Error(`expected a fresh key, got ${begun.kind}`);
    }
    return begun.claimId;
  };

  const backdate = (interval: string, key = 'k1') =>
    dataSource.query(
      `UPDATE idempotency_keys SET created_at = now() - $2::interval
       WHERE key = $1`,
      [key, interval],
    );

  it('lets a fresh key run, recording the claim without an outcome yet', async () => {
    const claimId = await claim();

    const [row] = await dataSource.query(
      `SELECT claim_id, fingerprint, completed_at, status_code
       FROM idempotency_keys WHERE key = 'k1'`,
    );
    expect(row).toMatchObject({
      claim_id: claimId,
      fingerprint: FINGERPRINT,
      completed_at: null,
      status_code: null,
    });
  });

  it('replays the stored outcome for the same request, exactly (F14.2.1)', async () => {
    const claimId = await claim();
    await service.complete(USER, 'k1', claimId, outcome);

    await expect(service.begin(USER, 'k1', FINGERPRINT)).resolves.toEqual({
      kind: 'replay',
      outcome,
    });
    // Replaying does not use up the key: it can be replayed again.
    await expect(service.begin(USER, 'k1', FINGERPRINT)).resolves.toMatchObject(
      { kind: 'replay' },
    );
  });

  it('refuses the same key for a different request, running or finished (F14.2.2)', async () => {
    const claimId = await claim();

    await expect(service.begin(USER, 'k1', OTHER_FINGERPRINT)).resolves.toEqual(
      { kind: 'mismatch' },
    );

    await service.complete(USER, 'k1', claimId, outcome);
    await expect(service.begin(USER, 'k1', OTHER_FINGERPRINT)).resolves.toEqual(
      { kind: 'mismatch' },
    );
  });

  it('says in-progress while the same request is still running', async () => {
    await claim();

    await expect(service.begin(USER, 'k1', FINGERPRINT)).resolves.toEqual({
      kind: 'in-progress',
    });
  });

  it('lets only one of several simultaneous identical requests run', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => service.begin(USER, 'k1', FINGERPRINT)),
    );

    expect(results.filter((r) => r.kind === 'run')).toHaveLength(1);
    expect(results.filter((r) => r.kind === 'in-progress')).toHaveLength(7);
    await expect(
      dataSource.query(`SELECT count(*)::int AS n FROM idempotency_keys`),
    ).resolves.toEqual([{ n: 1 }]);
  });

  it('frees the key when a request fails, so a corrected retry can use it', async () => {
    const claimId = await claim();

    await service.release(USER, 'k1', claimId);

    // Even with a different payload now: nothing succeeded under this key.
    await expect(
      service.begin(USER, 'k1', OTHER_FINGERPRINT),
    ).resolves.toMatchObject({ kind: 'run' });
  });

  it('never releases or overwrites a claim that is not its own', async () => {
    const claimId = await claim();
    const stranger = randomUUID();

    await service.release(USER, 'k1', stranger);
    await service.complete(USER, 'k1', stranger, outcome);

    const [row] = await dataSource.query(
      `SELECT claim_id, completed_at FROM idempotency_keys WHERE key = 'k1'`,
    );
    expect(row).toMatchObject({ claim_id: claimId, completed_at: null });
  });

  it('does not release a finished key', async () => {
    const claimId = await claim();
    await service.complete(USER, 'k1', claimId, outcome);

    await service.release(USER, 'k1', claimId);

    await expect(service.begin(USER, 'k1', FINGERPRINT)).resolves.toMatchObject(
      {
        kind: 'replay',
      },
    );
  });

  it('keeps users and keys apart', async () => {
    const claimId = await claim('k1', USER);
    await service.complete(USER, 'k1', claimId, outcome);

    // Another user, or another key, is fresh.
    await expect(
      service.begin(OTHER_USER, 'k1', FINGERPRINT),
    ).resolves.toMatchObject({ kind: 'run' });
    await expect(service.begin(USER, 'k2', FINGERPRINT)).resolves.toMatchObject(
      {
        kind: 'run',
      },
    );
  });

  it('forgets a key after 24 hours, finished or not (F14.2.1)', async () => {
    const claimId = await claim();
    await service.complete(USER, 'k1', claimId, outcome);
    await backdate('25 hours');

    // Even with another payload: the old key is gone.
    const begun = await service.begin(USER, 'k1', OTHER_FINGERPRINT);

    expect(begun).toMatchObject({ kind: 'run' });
    await expect(
      dataSource.query(`SELECT count(*)::int AS n FROM idempotency_keys`),
    ).resolves.toEqual([{ n: 1 }]);
  });

  it('still remembers a key just under 24 hours old', async () => {
    const claimId = await claim();
    await service.complete(USER, 'k1', claimId, outcome);
    await backdate('23 hours');

    await expect(service.begin(USER, 'k1', FINGERPRINT)).resolves.toMatchObject(
      {
        kind: 'replay',
      },
    );
  });

  it('abandons a claim that has been running for over a minute, but not a recent one', async () => {
    await claim();
    await backdate('30 seconds');
    await expect(service.begin(USER, 'k1', FINGERPRINT)).resolves.toEqual({
      kind: 'in-progress',
    });

    await backdate('61 seconds');
    await expect(service.begin(USER, 'k1', FINGERPRINT)).resolves.toMatchObject(
      { kind: 'run' },
    );
  });

  it('does not let a taken-over attempt overwrite the new claim', async () => {
    const stale = await claim();
    await backdate('2 minutes');
    const fresh = await claim();

    await service.complete(USER, 'k1', stale, { ...outcome, statusCode: 500 });

    const [row] = await dataSource.query(
      `SELECT claim_id, status_code FROM idempotency_keys WHERE key = 'k1'`,
    );
    expect(row).toMatchObject({ claim_id: fresh, status_code: null });
  });

  it('purges only keys older than 24 hours', async () => {
    await claim('old');
    await claim('new');
    await backdate('25 hours', 'old');

    await expect(service.purgeExpired()).resolves.toBe(1);

    const rows = await dataSource.query(`SELECT key FROM idempotency_keys`);
    expect(rows).toEqual([{ key: 'new' }]);
    await expect(service.purgeExpired()).resolves.toBe(0);
  });

  it('refuses an empty key, an over-long key and a half-finished row, in the database itself', async () => {
    const insert = (key: string, extra = '') =>
      dataSource.query(
        `INSERT INTO idempotency_keys (user_id, key, claim_id, fingerprint ${extra ? ', status_code' : ''})
         VALUES ($1, $2, gen_random_uuid(), $3 ${extra ? ', 201' : ''})`,
        [USER, key, FINGERPRINT],
      );

    await expect(insert('')).rejects.toMatchObject({
      driverError: { constraint: 'CHK_idempotency_keys_key' },
    });
    // The column itself stops a key over 255 characters (string_data_right_truncation).
    await expect(insert('x'.repeat(256))).rejects.toMatchObject({
      driverError: { code: '22001' },
    });
    // A status without a completion time is inconsistent.
    await expect(insert('half', 'status')).rejects.toMatchObject({
      driverError: { constraint: 'CHK_idempotency_keys_completed' },
    });
  });
});
