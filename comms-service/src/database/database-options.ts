import { readFileSync } from 'node:fs';
import type { TypeOrmModuleOptions } from '@nestjs/typeorm';
import type { DataSourceOptions } from 'typeorm';
import {
  Chat,
  ChatArchive,
  ChatLifecycleEvent,
  InboxEvent,
  Message,
} from './entities/index.js';
import { InitialPersistence1793552400000 } from './migrations/1793552400000-initial-persistence.js';
import { AddUnreadMessageIndex1793638800000 } from './migrations/1793638800000-add-unread-message-index.js';

export interface DatabaseEnvironment {
  DB_HOST: string;
  DB_PORT: number;
  DB_USERNAME: string;
  DB_DATABASE: string;
  DB_PASSWORD_FILE: string;
}

export const databaseEntities = [
  InboxEvent,
  ChatLifecycleEvent,
  Chat,
  Message,
  ChatArchive,
];

export function readDatabasePassword(path: string): string {
  const password = readFileSync(path, 'utf8').replace(/[\r\n]+$/, '');
  if (password.length === 0)
    throw new Error('Database password file must not be empty');
  return password;
}

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
    migrations: [
      InitialPersistence1793552400000,
      AddUnreadMessageIndex1793638800000,
    ],
    migrationsTableName: 'comms_service_migrations',
    migrationsRun: false,
    migrationsTransactionMode: 'all',
    synchronize: false,
  };
}
