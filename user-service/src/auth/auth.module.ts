import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { RedisProvider } from '../redis/redis.provider.js';
import { SecretService } from '../secret/secret.service.js';

@Module({
  controllers: [AuthController],
  providers: [AuthService, RedisProvider, SecretService],
})
export class AuthModule {}
