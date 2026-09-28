import { Module } from '@nestjs/common';
import { OtpService } from './otp.service.js';
import { OtpController } from './otp.controller.js';
import { RedisProvider } from '../redis/redis.provider.js';
import { BrokerModule } from '../broker/broker.module.js';
import { UsersModule } from '../users/users.module.js';

@Module({
  imports: [BrokerModule, UsersModule],
  providers: [OtpService, RedisProvider],
  controllers: [OtpController],
})
export class OtpModule {}
