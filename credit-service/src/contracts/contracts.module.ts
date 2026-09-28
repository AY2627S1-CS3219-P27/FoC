import { Module } from '@nestjs/common';
import { AccountEventContractValidator } from '@foc/contracts';

/** Provides strict wire-contract validation to messaging components. */
@Module({
  providers: [AccountEventContractValidator],
  exports: [AccountEventContractValidator],
})
export class ContractsModule {}
