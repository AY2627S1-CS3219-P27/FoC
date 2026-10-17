import { Module } from '@nestjs/common';
import { ContractsModule } from '../contracts/contracts.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { MessagingModule } from '../messaging/messaging.module.js';
import { ErrandCancelledConsumerLifecycle } from './errand-cancelled-consumer.lifecycle.js';
import { ErrandCancelledMessageHandler } from './errand-cancelled-message.handler.js';
import { ErrandCompletedConsumerLifecycle } from './errand-completed-consumer.lifecycle.js';
import { ErrandCompletedMessageHandler } from './errand-completed-message.handler.js';
import { ReleaseService } from './release.service.js';
import { ReleaseOperationProcessor } from './release-operation.processor.js';
import { TransferOperationProcessor } from './transfer-operation.processor.js';
import { TransferService } from './transfer.service.js';

@Module({
  imports: [ContractsModule, DatabaseModule, MessagingModule],
  providers: [
    ReleaseService,
    ReleaseOperationProcessor,
    TransferService,
    TransferOperationProcessor,
    ErrandCancelledMessageHandler,
    ErrandCancelledConsumerLifecycle,
    ErrandCompletedMessageHandler,
    ErrandCompletedConsumerLifecycle,
  ],
  exports: [
    ReleaseService,
    ReleaseOperationProcessor,
    TransferService,
    TransferOperationProcessor,
  ],
})
export class SettlementModule {}
