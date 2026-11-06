import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { InboxService } from './inbox.service.js';

@Module({
  imports: [DatabaseModule],
  providers: [InboxService],
  exports: [InboxService],
})
export class InboxModule {}
