import { readFileSync } from 'node:fs';
import type { TypeOrmModuleOptions } from '@nestjs/typeorm';
import type { DataSourceOptions } from 'typeorm';
import {
  CreditAccount,
  CreditAllocation,
  InboxEvent,
  OutboxEvent,
} from './entities/index.js';
import { InitialPersistence1735689600000 } from './migrations/1735689600000-initial-persistence.js';

export interface DatabaseEnvironment {
  DB_HOST: string;
  DB_PORT: number;
  DB_USERNAME: string;
  DB_DATABASE: string;
  DB_PASSWORD_FILE: string;
}

export const databaseEntities = [
  CreditAccount,
  CreditAllocation,
  InboxEvent,
  OutboxEvent,
];

/** Reads the database secret without treating spaces as disposable content. */
export function readDatabasePassword(passwordFile: string): string {
  // Secret files commonly end in a newline; remove only newline characters so
  // that leading or trailing spaces remain part of the configured password.
  const password = readFileSync(passwordFile, 'utf8').replace(/[\r\n]+$/, '');

  if (password.length === 0) {
    throw new Error('Database password file must not be empty');
  }

  return password;
}

/**
 * Produces the one TypeORM configuration shared by Nest and migration tooling.
 * Runtime schema synchronization stays disabled: migrations are the sole
 * authority for changing persistent credit data.
 */
export function createDatabaseOptions(
  environment: DatabaseEnvironment,
): TypeOrmModuleOptions & DataSourceOptions {
  return {
    type: 'postgres',
    host: environment.DB_HOST,
    port: environment.DB_PORT,
    username: environment.DB_USERNAME,
    password: readDatabasePassword(environment.DB_PASSWORD_FILE),
    database: environment.DB_DATABASE,
    entities: databaseEntities,
    migrations: [InitialPersistence1735689600000],
    migrationsTableName: 'credit_service_migrations',
    migrationsRun: false,
    migrationsTransactionMode: 'all',
    synchronize: false,
  };
}
