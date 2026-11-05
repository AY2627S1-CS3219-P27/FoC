import { Module } from '@nestjs/common';
import { RedisService } from './redis.service.js';
import { SocketRedisAdapterService } from './socket-redis-adapter.service.js';

@Module({
  providers: [RedisService, SocketRedisAdapterService],
  exports: [RedisService, SocketRedisAdapterService],
})
export class RedisModule {}
