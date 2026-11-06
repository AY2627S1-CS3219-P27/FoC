import { Module } from '@nestjs/common';
import { OpenRouterModule } from '../openrouter/openrouter.module.js';
import { IndexingService } from './indexing.service.js';

@Module({
  imports: [OpenRouterModule],
  providers: [IndexingService],
  exports: [IndexingService],
})
export class IndexingModule {}
