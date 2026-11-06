import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createDatabaseOptions,
  readDatabasePassword,
} from './database-options.js';

describe('database options', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rag-db-options-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function secret(content: string): string {
    const path = join(dir, 'password.secret');
    writeFileSync(path, content);
    return path;
  }

  it('strips only the trailing newline Docker secrets end with', () => {
    expect(readDatabasePassword(secret(' pass word \n'))).toBe(' pass word ');
  });

  it('rejects an empty password file', () => {
    expect(() => readDatabasePassword(secret('\n'))).toThrow(
      'Database password file must not be empty',
    );
  });

  it('never synchronizes the schema and runs migrations as configured', () => {
    const options = createDatabaseOptions({
      DB_HOST: 'rag-db',
      DB_PORT: 5432,
      DB_USERNAME: 'rag_service',
      DB_DATABASE: 'rag_service',
      DB_PASSWORD_FILE: secret('s3cret\n'),
      DB_MIGRATIONS_RUN: true,
    });

    expect(options).toMatchObject({
      type: 'postgres',
      host: 'rag-db',
      port: 5432,
      password: 's3cret',
      synchronize: false,
      migrationsRun: true,
      migrationsTransactionMode: 'all',
      migrationsTableName: 'rag_service_migrations',
    });
  });
});
