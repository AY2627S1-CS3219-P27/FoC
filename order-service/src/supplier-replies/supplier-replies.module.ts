import { Module } from '@nestjs/common';
import { LifecycleModule } from '../lifecycle/lifecycle.module.js';
import { MessagingModule } from '../messaging/messaging.module.js';
import { SupplierReplyConsumerLifecycle } from './supplier-reply-consumer.lifecycle.js';

@Module({
  imports: [LifecycleModule, MessagingModule],
  providers: [SupplierReplyConsumerLifecycle],
})
export class SupplierRepliesModule {}
