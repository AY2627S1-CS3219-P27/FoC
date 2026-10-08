import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { CreditOperationWorkerLifecycle } from './credit-operation-worker.lifecycle.js';
import { CreditOperationWorker } from './credit-operation.worker.js';
import { CreditOperationStore } from './credit-operation.store.js';
import { ReservationOperationProcessor } from './reservation-operation.processor.js';
import { ReservationService } from './reservation.service.js';

@Module({
  imports: [DatabaseModule],
  providers: [
    ReservationService,
    ReservationOperationProcessor,
    CreditOperationStore,
    CreditOperationWorker,
    CreditOperationWorkerLifecycle,
  ],
  exports: [
    ReservationService,
    ReservationOperationProcessor,
    CreditOperationWorker,
  ],
})
export class ReservationModule {}
