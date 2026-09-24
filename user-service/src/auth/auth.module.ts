import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { RedisProvider } from '../redis/redis.provider.js';
import { User } from '../users/user.entity.js';
import { SecretModule } from '../secret/secret.module.js';

@Module({
  imports: [SecretModule, TypeOrmModule.forFeature([User])],
  controllers: [AuthController],
  providers: [AuthService, RedisProvider],
})
export class AuthModule {}