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
            DB_PORT: Number(process.env.DB_PORT ?? 5440),
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
