import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { withActor } from '../src/audit/audit-context.js';
import { recordAudit } from '../src/audit/record-audit.js';
import { createDatabaseOptions } from '../src/database/database-options.js';
import { AuditEntry } from '../src/database/entities/index.js';

const USER = '42424242-4242-4242-8242-424242424242';
const TARGET = '11111111-1111-4111-8111-111111111111';

describe('the audit log table (real PostgreSQL, F14.4, F14.5)', () => {
  let dataSource: DataSource;

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
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  const entries = () =>
    dataSource.getRepository(AuditEntry).find({ order: { id: 'ASC' } });

  it('records who, what, where, before, after, version and when', async () => {
    await withActor(USER, () =>
      dataSource.transaction((manager) =>
        recordAudit(manager, {
          action: 'supplier.updated',
          targetType: 'supplier',
          targetId: TARGET,
          before: { floor: '1' },
          after: { floor: '2' },
          version: 2,
        }),
      ),
    );

    const written = (await entries()).at(-1)!;
    expect(written).toMatchObject({
      actorId: USER,
      action: 'supplier.updated',
      targetType: 'supplier',
      targetId: TARGET,
      before: { floor: '1' },
      after: { floor: '2' },
      version: 2,
    });
    expect(written.occurredAt).toBeInstanceOf(Date);
    expect(Date.now() - written.occurredAt.getTime()).toBeLessThan(60_000);
  });

  it('records no actor outside a request: the system (the seed)', async () => {
    await dataSource.transaction((manager) =>
      recordAudit(manager, {
        action: 'building.created',
        targetType: 'building',
        targetId: TARGET,
        after: { name: 'COM2' },
      }),
    );

    expect((await entries()).at(-1)).toMatchObject({
      actorId: null,
      before: null,
      version: null,
    });
  });

  it('numbers entries in the order they were written', async () => {
    for (const action of ['a.one', 'a.two', 'a.three']) {
      await dataSource.transaction((manager) =>
        recordAudit(manager, {
          action,
          targetType: 'category',
          targetId: TARGET,
        }),
      );
    }

    const ids = (await entries()).map((e) => BigInt(e.id));
    expect(ids).toEqual([...ids].sort((a, b) => (a < b ? -1 : 1)));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('commits with the change, and rolls back with it (F14.4)', async () => {
    const before = (await entries()).length;

    await expect(
      dataSource.transaction(async (manager) => {
        await recordAudit(manager, {
          action: 'brand.created',
          targetType: 'brand',
          targetId: TARGET,
        });
        throw new Error('the change itself failed');
      }),
    ).rejects.toThrow('the change itself failed');

    expect((await entries()).length).toBe(before);
  });

  describe('append-only (F14.5)', () => {
    it('refuses to update an entry', async () => {
      await expect(
        dataSource.query(`UPDATE audit_entries SET action = 'tampered'`),
      ).rejects.toThrow(/append-only/);
    });

    it('refuses to delete an entry', async () => {
      await expect(
        dataSource.query(`DELETE FROM audit_entries`),
      ).rejects.toThrow(/append-only/);
    });

    it('refuses to truncate the log', async () => {
      await expect(dataSource.query(`TRUNCATE audit_entries`)).rejects.toThrow(
        /append-only/,
      );
    });

    it('leaves the entries untouched after those attempts', async () => {
      expect((await entries()).length).toBeGreaterThan(0);
      expect((await entries()).some((e) => e.action === 'tampered')).toBe(
        false,
      );
    });
  });

  it('keeps entries for a record that no longer exists: there is no foreign key (F14.5)', async () => {
    const gone = '99999999-9999-4999-8999-999999999999';
    await dataSource.transaction((manager) =>
      recordAudit(manager, {
        action: 'supplier.created',
        targetType: 'supplier',
        targetId: gone,
        after: { name: 'Vanished Stall' },
        version: 1,
      }),
    );

    // There is no suppliers row with that id, and the entry is still there.
    const rows = await dataSource.query(
      `SELECT count(*)::int AS n FROM suppliers WHERE id = $1`,
      [gone],
    );
    expect(rows).toEqual([{ n: 0 }]);
    expect((await entries()).some((e) => e.targetId === gone)).toBe(true);
  });

  it.each([
    [
      'an unknown target type',
      'widget',
      'a.b',
      'CHK_audit_entries_target_type',
    ],
    ['a blank action', 'supplier', '   ', 'CHK_audit_entries_action'],
  ])('refuses %s in the database itself', async (_, type, action, check) => {
    await expect(
      dataSource.query(
        `INSERT INTO audit_entries (action, target_type, target_id)
         VALUES ($1, $2, $3)`,
        [action, type, TARGET],
      ),
    ).rejects.toMatchObject({ driverError: { constraint: check } });
  });
});
