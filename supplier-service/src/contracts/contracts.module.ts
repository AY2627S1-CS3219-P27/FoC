import { AccountEventContractValidator } from '@foc/contracts';
import { Module } from '@nestjs/common';

/** Provides strict wire-contract validation to messaging components. */
@Module({
  providers: [AccountEventContractValidator],
  exports: [AccountEventContractValidator],
})
export class ContractsModule {}
