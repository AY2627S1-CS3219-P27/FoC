import { Module } from '@nestjs/common';
import { PasswordResetService } from './password-reset.service.js';
import { PasswordResetController } from './password-reset.controller.js';
import { RedisProvider } from '../redis/redis.provider.js';
import { BrokerModule } from '../broker/broker.module.js';
import { UsersModule } from '../users/users.module.js';

@Module({
  imports: [BrokerModule, UsersModule],
  providers: [PasswordResetService, RedisProvider],
  controllers: [PasswordResetController],
})
export class PasswordResetModule {}