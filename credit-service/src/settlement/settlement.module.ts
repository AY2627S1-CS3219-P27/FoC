import { Module } from '@nestjs/common';
import { ContractsModule } from '../contracts/contracts.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { MessagingModule } from '../messaging/messaging.module.js';
import { ErrandCompletedConsumerLifecycle } from './errand-completed-consumer.lifecycle.js';
import { ErrandCompletedMessageHandler } from './errand-completed-message.handler.js';
import { TransferService } from './transfer.service.js';

@Module({
  imports: [ContractsModule, DatabaseModule, MessagingModule],
  providers: [
    TransferService,
    ErrandCompletedMessageHandler,
    ErrandCompletedConsumerLifecycle,
  ],
  exports: [TransferService],
})
export class SettlementModule {}
