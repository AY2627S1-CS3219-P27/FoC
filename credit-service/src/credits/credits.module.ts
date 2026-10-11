import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { CreditAccountQueryService } from './credit-account-query.service.js';
import { CreditsController } from './credits.controller.js';

@Module({
  imports: [DatabaseModule],
  controllers: [CreditsController],
  providers: [CreditAccountQueryService],
  exports: [CreditAccountQueryService],
})
export class CreditsModule {}
