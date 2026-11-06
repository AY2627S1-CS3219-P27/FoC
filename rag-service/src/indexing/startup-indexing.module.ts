import { Module } from '@nestjs/common';
import { IndexingModule } from './indexing.module.js';
import { StartupIndexerService } from './startup-indexer.service.js';

/** Separate from IndexingModule so the index-docs command does not run it. */
@Module({
  imports: [IndexingModule],
  providers: [StartupIndexerService],
})
export class StartupIndexingModule {}
