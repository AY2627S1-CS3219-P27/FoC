import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { environmentSchema } from '../config/environment.schema.js';
import { DatabaseModule } from '../database/database.module.js';
import { IndexingModule } from './indexing.module.js';
import { IndexingService } from './indexing.service.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validationSchema: environmentSchema,
    }),
    DatabaseModule,
    IndexingModule,
  ],
})
class IndexDocsModule {}

/**
 * `npm run index-docs`: rebuilds the index now, without a restart. Run it in
 * the container: docker compose exec rag-service npm run index-docs
 */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(IndexDocsModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const count = await app.get(IndexingService).reindex();
    console.log(`Indexed ${count} chunks.`);
  } finally {
    await app.close();
  }
}

try {
  await main();
} catch (error) {
  console.error(
    `Indexing failed; any existing index stays in use: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exitCode = 1;
}
