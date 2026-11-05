import 'dotenv/config';
import { DataSource } from 'typeorm';
import { createDatabaseOptions } from './database-options.js';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function databasePort(): number {
  const value = Number(required('DB_PORT'));
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error('DB_PORT must be a valid TCP port');
  }
  return value;
}

export default new DataSource(
  createDatabaseOptions({
    DB_HOST: required('DB_HOST'),
    DB_PORT: databasePort(),
    DB_USERNAME: required('DB_USERNAME'),
    DB_DATABASE: required('DB_DATABASE'),
    DB_PASSWORD_FILE: required('DB_PASSWORD_FILE'),
  }),
);
