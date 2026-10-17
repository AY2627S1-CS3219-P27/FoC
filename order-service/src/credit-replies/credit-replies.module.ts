import { Module } from '@nestjs/common';
import { LifecycleModule } from '../lifecycle/lifecycle.module.js';
import { MessagingModule } from '../messaging/messaging.module.js';
import { CreditReplyConsumerLifecycle } from './credit-reply-consumer.lifecycle.js';

@Module({
  imports: [LifecycleModule, MessagingModule],
  providers: [CreditReplyConsumerLifecycle],
})
export class CreditRepliesModule {}
