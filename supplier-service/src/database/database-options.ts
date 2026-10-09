import { readFileSync } from 'node:fs';
import type { TypeOrmModuleOptions } from '@nestjs/typeorm';
import type { DataSourceOptions } from 'typeorm';
import { databaseEntities } from './entities/index.js';
import { databaseMigrations } from './migrations/index.js';

export interface DatabaseEnvironment {
  DB_HOST: string;
  DB_PORT: number;
  DB_USERNAME: string;
  DB_DATABASE: string;
  DB_PASSWORD_FILE: string;
  DB_MIGRATIONS_RUN: boolean;
}

/** Reads the database secret without treating spaces as disposable content. */
export function readDatabasePassword(passwordFile: string): string {
  // Docker secret files commonly end in a newline; remove only newline
  // characters so leading or trailing spaces stay part of the password.
  const password = readFileSync(passwordFile, 'utf8').replace(/[\r\n]+$/, '');

  if (password.length === 0) {
    throw new Error('Database password file must not be empty');
  }

  return password;
}

/**
 * Produces the one TypeORM configuration shared by Nest and the migration CLI
 * (see data-source.ts), so the two can never drift apart. Schema
 * synchronization stays disabled: migrations are the sole authority for
 * changing the supplier schema.
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
    migrations: databaseMigrations,
    migrationsTableName: 'supplier_service_migrations',
    migrationsRun: environment.DB_MIGRATIONS_RUN,
    migrationsTransactionMode: 'all',
    synchronize: false,
  };
}
