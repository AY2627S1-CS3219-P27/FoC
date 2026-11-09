import { Module } from '@nestjs/common';
import { AccountEventContractValidator } from '@foc/contracts';

@Module({
  providers: [AccountEventContractValidator],
  exports: [AccountEventContractValidator],
})
export class ContractsModule {}
