import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool as PgPool } from 'pg';
import { envs } from '../utils/envs.ts';

// pg must be loaded through the CJS require path (createRequire), not an ESM
// import: PgInstrumentation patches module loads via require-in-the-middle,
// which only sees require() calls (see utils/logger.ts for the full reason).
// An ESM import would silently produce a database client with no spans.
const req = createRequire(import.meta.url);
const { Pool } = req('pg') as typeof import('pg');

const pool: PgPool = new Pool({
  host: envs.DB_HOST,
  port: envs.DB_PORT,
  user: envs.DB_USERNAME,
  database: envs.DB_DATABASE,
  password: readFileSync(envs.DB_PASSWORD_FILE, 'utf8').trim(),
});

// Schema wiring lands with the tables (db/schema.ts); the client works for
// queries as-is.
export const db = drizzle(pool);
export { pool };
