import { Module } from '@nestjs/common';
import { OtpService } from './otp.service.js';
import { OtpController } from './otp.controller.js';
import { RedisProvider } from '../redis/redis.provider.js';
import { BrokerModule } from '../broker/broker.module.js';

@Module({
  imports: [BrokerModule],
  providers: [OtpService, RedisProvider],
  controllers: [OtpController],
})
export class OtpModule {}
