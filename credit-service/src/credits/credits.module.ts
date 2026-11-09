import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { CreditAccountQueryService } from './credit-account-query.service.js';
import { CreditTransactionQueryService } from './credit-transaction-query.service.js';
import { CreditsController } from './credits.controller.js';

@Module({
  imports: [DatabaseModule],
  controllers: [CreditsController],
  providers: [CreditAccountQueryService, CreditTransactionQueryService],
  exports: [CreditAccountQueryService, CreditTransactionQueryService],
})
export class CreditsModule {}
