import { Module } from '@nestjs/common';
import { AccountInitializationModule } from '../account-initialization/account-initialization.module.js';
import { ContractsModule } from '../contracts/contracts.module.js';
import { MessagingModule } from '../messaging/messaging.module.js';
import { SettlementModule } from '../settlement/settlement.module.js';
import { CreditEventsConsumerLifecycle } from './credit-events-consumer.lifecycle.js';
import { CreditEventsMessageHandler } from './credit-events-message.handler.js';

/** Single pub/sub ingress for the fact events that drive the credit ledger. */
@Module({
  imports: [
    AccountInitializationModule,
    ContractsModule,
    MessagingModule,
    SettlementModule,
  ],
  providers: [CreditEventsMessageHandler, CreditEventsConsumerLifecycle],
})
export class EventsModule {}
