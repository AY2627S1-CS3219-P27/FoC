import { Module } from '@nestjs/common';
import { ContractsModule } from '../contracts/contracts.module.js';
import { MessagingModule } from '../messaging/messaging.module.js';
import { SuppliersModule } from '../suppliers/suppliers.module.js';
import { SupplierValidationConsumerLifecycle } from './supplier-validation-consumer.lifecycle.js';
import { SupplierValidationMessageHandler } from './supplier-validation-message.handler.js';
import { SupplierValidationService } from './supplier-validation.service.js';

/** Wires Order Service's supplier-validation requests to their answers (F15.7). */
@Module({
  imports: [ContractsModule, MessagingModule, SuppliersModule],
  providers: [
    SupplierValidationService,
    SupplierValidationMessageHandler,
    SupplierValidationConsumerLifecycle,
  ],
  exports: [SupplierValidationService, SupplierValidationMessageHandler],
})
export class ValidationModule {}
