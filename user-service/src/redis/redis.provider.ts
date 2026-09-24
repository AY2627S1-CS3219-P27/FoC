import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

export const REDIS = Symbol('Redis');

export const RedisProvider = {
  provide: REDIS,
  useFactory: async (configService: ConfigService) =>
    new Redis({
      port: configService.get<number>('REDIS_PORT'),
      host: configService.get<string>('REDIS_HOST'),
      username: configService.get<string>('REDIS_USERNAME'),
      db: configService.get<number>('REDIS_DB_INDEX'),
    }),
  inject: [ConfigService],
};
