import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

export interface ScoredChunk {
  id: string;
  title: string;
  section: string;
  text: string;
  /** Cosine similarity: 1 means the same meaning. */
  score: number;
}

@Injectable()
export class ChunkSearchService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * The chunks nearest to a question's embedding, best first. Only chunks from
   * the same model are compared: vectors from different models mean nothing to
   * each other.
   */
  async nearest(
    embedding: number[],
    embeddingModel: string,
    limit: number,
  ): Promise<ScoredChunk[]> {
    const rows = await this.dataSource.query<
      (Omit<ScoredChunk, 'score'> & { score: string | number })[]
    >(
      `SELECT id, title, section, text,
              1 - (embedding <=> $1::vector) AS score
       FROM chunks
       WHERE embedding_model = $2
       ORDER BY embedding <=> $1::vector
       LIMIT $3`,
      [JSON.stringify(embedding), embeddingModel, limit],
    );
    return rows.map((row) => ({ ...row, score: Number(row.score) }));
  }
}
