import { Module } from '@nestjs/common';
import { AccountEventContractValidator } from './account-event-contract.validator.js';

/** Provides strict wire-contract validation to messaging components. */
@Module({
  providers: [AccountEventContractValidator],
  exports: [AccountEventContractValidator],
})
export class ContractsModule {}
