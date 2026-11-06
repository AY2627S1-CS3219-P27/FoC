import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createDatabaseOptions,
  databaseEntities,
  readDatabasePassword,
} from './database-options.js';
import { InitialPersistence1793552400000 } from './migrations/1793552400000-initial-persistence.js';
import { AddUnreadMessageIndex1793638800000 } from './migrations/1793638800000-add-unread-message-index.js';

describe('database options', () => {
  const directory = mkdtempSync(join(tmpdir(), 'comms-db-options-'));
  const passwordFile = join(directory, 'password');

  afterAll(() => rmSync(directory, { recursive: true, force: true }));

  it('removes only secret-file newlines', () => {
    writeFileSync(passwordFile, ' pass word \r\n');
    expect(readDatabasePassword(passwordFile)).toBe(' pass word ');
  });

  it('keeps schema mutation explicit in every environment', () => {
    writeFileSync(passwordFile, 'secret\n');
    const options = createDatabaseOptions({
      DB_HOST: 'comms-db',
      DB_PORT: 5432,
      DB_USERNAME: 'comms_service',
      DB_DATABASE: 'comms_service',
      DB_PASSWORD_FILE: passwordFile,
    });

    expect(options.synchronize).toBe(false);
    expect(options.migrationsRun).toBe(false);
    expect(options.migrationsTransactionMode).toBe('all');
    expect(options.migrationsTableName).toBe('comms_service_migrations');
    expect(options.entities).toEqual(databaseEntities);
    expect(options.migrations).toEqual([
      InitialPersistence1793552400000,
      AddUnreadMessageIndex1793638800000,
    ]);
  });

  it('rejects an empty password file', () => {
    writeFileSync(passwordFile, '\n');
    expect(() => readDatabasePassword(passwordFile)).toThrow(
      'must not be empty',
    );
  });
});
