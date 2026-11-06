import { Module } from '@nestjs/common';
import {
  AccountEventContractValidator,
  DomainEventDispatcher,
} from '@foc/contracts';

@Module({
  providers: [
    AccountEventContractValidator,
    {
      // The shared dispatcher is framework-neutral and carries no Nest
      // metadata, so it is constructed explicitly instead of class-injected.
      provide: DomainEventDispatcher,
      inject: [AccountEventContractValidator],
      useFactory: (contracts: AccountEventContractValidator) =>
        new DomainEventDispatcher(contracts),
    },
  ],
  exports: [AccountEventContractValidator, DomainEventDispatcher],
})
export class ContractsModule {}
