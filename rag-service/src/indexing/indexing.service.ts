import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import type { EnvironmentVariables } from '../config/environment.schema.js';
import { Chunk } from '../database/entities/index.js';
import { OpenRouterClient } from '../openrouter/openrouter.client.js';
import { chunkFolder, embeddingInput, type DocumentChunk } from './chunker.js';

/** Texts sent to the embedding model in one call. */
const EMBEDDING_BATCH_SIZE = 100;
/** A batch is far bigger than one question, so it gets a longer limit. */
const EMBEDDING_BATCH_TIMEOUT_MS = 30_000;
/** pg_advisory_xact_lock key: one re-index at a time ("RAG" in ASCII). */
const REINDEX_LOCK_KEY = 0x524147;

/** What makes a stored chunk current; embeddings follow from these. */
function fingerprint(
  chunk: DocumentChunk & { embeddingModel: string },
): string {
  return JSON.stringify([
    chunk.document,
    chunk.title,
    chunk.section,
    chunk.service,
    chunk.text,
    chunk.embeddingModel,
  ]);
}

@Injectable()
export class IndexingService {
  private readonly logger = new Logger(IndexingService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly openRouter: OpenRouterClient,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  /**
   * Whether the stored chunks match the documents and the configured model.
   * Compares text only, so checking costs no model call.
   */
  async isUpToDate(): Promise<boolean> {
    const embeddingModel = this.openRouter.embeddingModel;
    const wanted = (await this.readDocuments()).map((chunk) =>
      fingerprint({ ...chunk, embeddingModel }),
    );
    const stored = (
      await this.dataSource.getRepository(Chunk).find({
        select: {
          document: true,
          title: true,
          section: true,
          service: true,
          text: true,
          embeddingModel: true,
        },
      })
    ).map(fingerprint);

    const storedSet = new Set(stored);
    return (
      stored.length === wanted.length &&
      wanted.every((item) => storedSet.has(item))
    );
  }

  /**
   * Rebuilds the index from the documents. Everything that can fail for
   * outside reasons happens before the transaction, and the swap itself is all
   * or nothing, so a failure at any point leaves the old index answering.
   * Returns how many chunks are now indexed.
   */
  async reindex(): Promise<number> {
    const chunks = await this.readDocuments();
    const embeddingModel = this.openRouter.embeddingModel;

    const embeddings: number[][] = [];
    for (let start = 0; start < chunks.length; start += EMBEDDING_BATCH_SIZE) {
      const batch = chunks.slice(start, start + EMBEDDING_BATCH_SIZE);
      embeddings.push(
        ...(await this.openRouter.embed(
          batch.map(embeddingInput),
          EMBEDDING_BATCH_TIMEOUT_MS,
        )),
      );
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock($1)', [
        REINDEX_LOCK_KEY,
      ]);
      await manager.createQueryBuilder().delete().from(Chunk).execute();
      await manager.insert(
        Chunk,
        chunks.map((chunk, index) => ({
          ...chunk,
          id: randomUUID(),
          embedding: embeddings[index],
          embeddingModel,
        })),
      );
    });

    this.logger.log(`Indexed ${chunks.length} chunks with ${embeddingModel}`);
    return chunks.length;
  }

  private readDocuments(): Promise<DocumentChunk[]> {
    return chunkFolder(this.config.get('SUPPORT_DOCS_PATH', { infer: true }));
  }
}
