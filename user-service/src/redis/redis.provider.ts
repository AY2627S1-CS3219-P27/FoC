import { Redis } from 'ioredis';

export const REDIS = Symbol('Redis');

export const RedisProvider = {
  provide: REDIS,
  useFactory: () =>
    new Redis({
      port: Number(process.env.REDIS_PORT),
      host: process.env.REDIS_HOST,
      username: process.env.REDIS_USERNAME,
      db: Number(process.env.REDIS_DB_INDEX),
    }),
};
