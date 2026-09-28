import { Module } from '@nestjs/common';
import { AccountAllocationService } from './account-allocation.service.js';

/** Exposes credit-account use cases to transport and messaging modules. */
@Module({
  providers: [AccountAllocationService],
  exports: [AccountAllocationService],
})
export class AccountModule {}
