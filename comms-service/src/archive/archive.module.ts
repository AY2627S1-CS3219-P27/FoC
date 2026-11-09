import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { SocketModule } from '../socket/socket.module.js';
import { ArchiveClaimService } from './archive-claim.service.js';
import { ArchiveService } from './archive.service.js';
import { ArchiveWorker } from './archive.worker.js';

@Module({
  imports: [DatabaseModule, SocketModule],
  providers: [ArchiveClaimService, ArchiveService, ArchiveWorker],
  exports: [ArchiveClaimService, ArchiveService],
})
export class ArchiveModule {}
