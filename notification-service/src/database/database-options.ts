import { readFileSync } from 'node:fs';
import type { TypeOrmModuleOptions } from '@nestjs/typeorm';
import type { DataSourceOptions } from 'typeorm';
import {
  InboxEvent,
  NotificationDelivery,
  Subscription,
} from './entities/index.js';
import { InitialNotificationPersistence1794000000000 } from './migrations/1794000000000-initial-persistence.js';

export interface DatabaseEnvironment {
  DB_HOST: string;
  DB_PORT: number;
  DB_USERNAME: string;
  DB_DATABASE: string;
  DB_PASSWORD_FILE: string;
  DB_MIGRATIONS_RUN: boolean;
}

export const databaseEntities = [
  Subscription,
  InboxEvent,
  NotificationDelivery,
];

export const databaseMigrations = [InitialNotificationPersistence1794000000000];

export function readDatabasePassword(path: string): string {
  const password = readFileSync(path, 'utf8').trim();
  if (password.length === 0) {
    throw new Error('Database password file must not be empty');
  }
  return password;
}

/**
 * The schema is migration-owned in every environment. Synchronize is never
 * enabled: the inbox and delivery tables carry constraints that must exist
 * before the consumer starts.
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
    migrationsTableName: 'notification_service_migrations',
    migrationsRun: environment.DB_MIGRATIONS_RUN,
    migrationsTransactionMode: 'all',
    synchronize: false,
  };
}
