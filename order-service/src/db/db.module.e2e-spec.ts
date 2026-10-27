import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type pg from 'pg';
import { createTestDb } from '../../test/db.js';
import { DbModule, POOL } from './db.module.js';

const boot = async (database: string, migrationsRun: boolean) => {
  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        load: [
          () => ({
            DB_HOST: process.env.DB_HOST ?? 'localhost',
            DB_PORT: Number(process.env.DB_PORT ?? 5436),
            DB_USERNAME: process.env.DB_USERNAME ?? 'order_service',
            DB_PASSWORD_FILE: process.env.DB_PASSWORD_FILE ?? './secrets/order_db_password.secret',
            DB_DATABASE: database,
            DB_MIGRATIONS_RUN: migrationsRun,
          }),
        ],
      }),
      DbModule,
    ],
  }).compile();
  const pool = module.get<pg.Pool>(POOL);
  const { rows } = await pool.query(`SELECT to_regclass('outbox_events') AS t`);
  await module.close();
  return rows[0].t;
};

describe('DbModule migrations on startup', () => {
  it('migrates an empty database when DB_MIGRATIONS_RUN is on, and leaves it alone when off', async () => {
    const on = await createTestDb({ migrated: false });
    const off = await createTestDb({ migrated: false });
    try {
      expect(await boot(on.name, true)).toBe('outbox_events');
      expect(await boot(off.name, false)).toBeNull();
    } finally {
      await on.close();
      await off.close();
    }
  });

  it('is a no-op on an already migrated database', async () => {
    const t = await createTestDb();
    try {
      expect(await boot(t.name, true)).toBe('outbox_events');
    } finally {
      await t.close();
    }
  });
});

describe('errands table after the delivery building migration', () => {
  const insert = (
    pool: pg.Pool,
    over: { delivery_location?: string | null; cancellation_reason?: string },
  ) =>
    pool.query(
      `INSERT INTO errands (id, requester_id, supplier_id, delivery_building_id, delivery_detail,
         delivery_location, reward_credits, collection_items, status, cancellation_reason, last_sequence_number)
       VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'Level 3 04-02',
         $1, 5, 'a coffee', 'Cancelled', $2, 1)`,
      [over.delivery_location ?? null, over.cancellation_reason],
    );

  it('takes a null delivery location and the BUILDING_UNAVAILABLE reason, and still refuses an unlisted reason', async () => {
    const t = await createTestDb();
    try {
      await insert(t.pool, { cancellation_reason: 'BUILDING_UNAVAILABLE' });
      await expect(insert(t.pool, { cancellation_reason: 'because' })).rejects.toThrow(
        /errands_cancellation_reason_valid/,
      );
    } finally {
      await t.close();
    }
  });
});
