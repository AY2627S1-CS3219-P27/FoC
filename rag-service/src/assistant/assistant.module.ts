import { Module } from '@nestjs/common';
import { OpenRouterModule } from '../openrouter/openrouter.module.js';
import { AssistantController } from './assistant.controller.js';
import { AssistantService } from './assistant.service.js';
import { ChunkSearchService } from './chunk-search.service.js';

@Module({
  imports: [OpenRouterModule],
  controllers: [AssistantController],
  providers: [AssistantService, ChunkSearchService],
})
export class AssistantModule {}
