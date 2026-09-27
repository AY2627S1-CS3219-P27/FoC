import { readFileSync } from 'node:fs';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is required`);
  return v;
};

const pool = new pg.Pool({
  host: env('DB_HOST'),
  port: Number(env('DB_PORT')),
  user: env('DB_USERNAME'),
  database: env('DB_DATABASE'),
  password: readFileSync(env('DB_PASSWORD_FILE'), 'utf8').trim(),
});

try {
  await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
  console.log('migrations applied');
} finally {
  await pool.end();
}
