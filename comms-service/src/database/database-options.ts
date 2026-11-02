import { readFileSync } from 'node:fs';
import type { TypeOrmModuleOptions } from '@nestjs/typeorm';
import type { DataSourceOptions } from 'typeorm';

export interface DatabaseEnvironment {
  DB_HOST: string;
  DB_PORT: number;
  DB_USERNAME: string;
  DB_DATABASE: string;
  DB_PASSWORD_FILE: string;
}

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
    entities: [],
    migrations: [],
    migrationsTableName: 'comms_service_migrations',
    migrationsRun: false,
    migrationsTransactionMode: 'all',
    synchronize: false,
  };
}
