import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from 'redis';

export const REDIS = Symbol('Redis');

/**
 * How many times the initial connection may fail before bootstrap aborts.
 *
 * node-redis' default strategy retries forever, so `connect()` never settles
 * against an unreachable store — the factory (and therefore Nest) would pending
 * indefinitely instead of failing fast. Only the *startup* phase is bounded;
 * see the strategy below.
 */
export const MAX_STARTUP_RETRIES = 5;

export const RedisProvider = {
  provide: REDIS,
  useFactory: async (configService: ConfigService) => {
    let hasConnectedOnce = false;

    const client = createClient({
      socket: {
        port: configService.get<number>('REDIS_PORT'),
        host: configService.get<string>('REDIS_HOST'),
        // Custom reconnect strategy identical to node-redis' default
        // with the exception of adding a maximum number of startup tries.
        // Node-redis by default just uses exponential backoff + jitter
        reconnectStrategy: (retries: number) => {
          if (!hasConnectedOnce && retries >= MAX_STARTUP_RETRIES) {
            return new Error(
              `Redis unreachable after ${retries} connection attempts`,
            );
          }
          // The default node-redis curve. Exponential backoff capped at 2s,
          // with up to 200ms of jitter.
          return (
            Math.min(2 ** retries * 50, 2000) + Math.floor(Math.random() * 200)
          );
        },
      },
      username: configService.get<string>('REDIS_USERNAME'),
      database: configService.get<number>('REDIS_DB_INDEX'),
    });

    client.on('error', (err) => {
      Logger.error(`Redis connection error: ${err.message}`, 'RedisProvider');
    });

    await client.connect();
    hasConnectedOnce = true;
    return client;
  },
  inject: [ConfigService],
};
