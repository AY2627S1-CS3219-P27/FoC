import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { createDatabaseOptions } from '../src/database/database-options.js';

describe('rag-service schema (real PostgreSQL with pgvector)', () => {
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

  it('switches on pgvector', async () => {
    const rows: unknown[] = await dataSource.query(
      `SELECT 1 FROM pg_extension WHERE extname = 'vector'`,
    );

    expect(rows).toHaveLength(1);
  });

  it('compares vectors by cosine distance', async () => {
    const [row]: { same: number; opposite: number }[] = await dataSource.query(
      `SELECT '[1,0]'::vector <=> '[1,0]'::vector AS same,
              '[1,0]'::vector <=> '[-1,0]'::vector AS opposite`,
    );

    expect(row.same).toBeCloseTo(0);
    expect(row.opposite).toBeCloseTo(2);
  });

  // The drift check: the models the code declares match what migrations built.
  it('leaves nothing for TypeORM to change', async () => {
    const pending = await dataSource.driver.createSchemaBuilder().log();

    expect(pending.upQueries).toEqual([]);
  });
});
