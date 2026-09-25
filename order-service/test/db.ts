import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

// Defaults match the `order-db` container from compose (host port 5436).
const conn = () => ({
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5436),
  user: process.env.DB_USERNAME ?? 'orderUser',
  password: readFileSync(
    process.env.DB_PASSWORD_FILE ?? './secrets/order_db_password.secret',
    'utf8',
  ).trim(),
});

// A throwaway database per call, migrated from ./drizzle, so tests never touch dev data.
export async function createTestDb() {
  const admin = new pg.Pool({ ...conn(), database: 'postgres' });
  const name = `order_test_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE DATABASE ${name}`);
  const pool = new pg.Pool({ ...conn(), database: name });
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: './drizzle' });
  return {
    db,
    async close() {
      await pool.end();
      await admin.query(`DROP DATABASE ${name}`);
      await admin.end();
    },
  };
}
