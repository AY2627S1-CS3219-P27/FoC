import { Module } from '@nestjs/common';
import { ContractsModule } from '../contracts/contracts.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { MessagingModule } from '../messaging/messaging.module.js';
import { CreditReservationAdjustmentConsumerLifecycle } from './credit-reservation-adjustment-consumer.lifecycle.js';
import { CreditReservationAdjustmentMessageHandler } from './credit-reservation-adjustment-message.handler.js';
import { CreditReservationConsumerLifecycle } from './credit-reservation-consumer.lifecycle.js';
import { CreditReservationMessageHandler } from './credit-reservation-message.handler.js';
import { CreditOperationWorkerLifecycle } from './credit-operation-worker.lifecycle.js';
import { CreditOperationWorker } from './credit-operation.worker.js';
import { CreditOperationStore } from './credit-operation.store.js';
import { ReservationOperationProcessor } from './reservation-operation.processor.js';
import { ReservationAdjustmentService } from './reservation-adjustment.service.js';
import { ReservationService } from './reservation.service.js';

@Module({
  imports: [ContractsModule, DatabaseModule, MessagingModule],
  providers: [
    ReservationService,
    ReservationAdjustmentService,
    CreditReservationMessageHandler,
    CreditReservationAdjustmentMessageHandler,
    CreditReservationConsumerLifecycle,
    CreditReservationAdjustmentConsumerLifecycle,
    ReservationOperationProcessor,
    CreditOperationStore,
    CreditOperationWorker,
    CreditOperationWorkerLifecycle,
  ],
  exports: [
    ReservationService,
    ReservationAdjustmentService,
    ReservationOperationProcessor,
    CreditOperationWorker,
  ],
})
export class ReservationModule {}
