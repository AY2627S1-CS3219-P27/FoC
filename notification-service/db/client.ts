import { readFileSync } from 'node:fs';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { envs } from '../utils/envs.ts';

const pool = new Pool({
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
