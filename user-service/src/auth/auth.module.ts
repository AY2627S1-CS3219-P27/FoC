import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { RedisProvider } from '../redis/redis.provider.js';
import { SecretModule } from '../secret/secret.module.js';
import { UsersModule } from '../users/users.module.js';

@Module({
  imports: [SecretModule, UsersModule],
  controllers: [AuthController],
  providers: [AuthService, RedisProvider],
})
export class AuthModule {}