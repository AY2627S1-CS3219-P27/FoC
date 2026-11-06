import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module.js';
import { DispatchService } from './dispatch.service.js';
import { WebPushSender } from './web-push.sender.js';

@Module({
  imports: [DatabaseModule, SubscriptionsModule],
  providers: [WebPushSender, DispatchService],
  exports: [DispatchService],
})
export class DispatchModule {}
