import { Module } from '@nestjs/common';
import { OpenRouterClient } from './openrouter.client.js';

@Module({
  providers: [OpenRouterClient],
  exports: [OpenRouterClient],
})
export class OpenRouterModule {}
