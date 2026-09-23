import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from 'redis';

export const REDIS = Symbol('Redis');

export const RedisProvider = {
  provide: REDIS,
  useFactory: async (configService: ConfigService) => {
    const client = createClient({
      socket: {
        port: configService.get<number>('REDIS_PORT'),
        host: configService.get<string>('REDIS_HOST'),
      },
      username: configService.get<string>('REDIS_USERNAME'),
      database: configService.get<number>('REDIS_DB_INDEX'),
    });

    // node-redis requires an `error` listener: without one, any emitted error
    // crashes the process. ioredis tolerated its absence at startup.
    client.on('error', (err) => {
      Logger.error(`Redis connection error: ${err.message}`, 'RedisProvider');
    });

    // Fail fast: an unreachable store aborts bootstrap instead of the services
    // silently discovering it mid-request. Previously (ioredis) the client
    // connected lazily and the app booted regardless.
    await client.connect();
    return client;
  },
  inject: [ConfigService],
};
