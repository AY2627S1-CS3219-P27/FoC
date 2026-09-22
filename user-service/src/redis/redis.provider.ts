import { Redis } from 'ioredis';

export const REDIS = Symbol('Redis');

function requiredEnv(envVar: string): string {
  const value = process.env[envVar];
  if (value === undefined || value === '') {
    throw new Error(`Environment variable ${envVar} is not set`);
  }
  return value;
}

function requiredPort(envVar: string): number {
  const value = Number(requiredEnv(envVar));
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`Environment variable ${envVar} must be a valid port`);
  }
  return value;
}

function requiredDbIndex(envVar: string): number {
  const value = Number(requiredEnv(envVar));
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Environment variable ${envVar} must be a valid DB index`);
  }
  return value;
}

export const RedisProvider = {
  provide: REDIS,
  useFactory: () =>
    new Redis({
      port: requiredPort('REDIS_PORT'),
      host: requiredEnv('REDIS_HOST'),
      username: requiredEnv('REDIS_USERNAME'),
      db: requiredDbIndex('REDIS_DB_INDEX'),
    }),
};
