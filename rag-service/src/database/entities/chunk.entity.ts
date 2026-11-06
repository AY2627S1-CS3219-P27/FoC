import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  Unique,
} from 'typeorm';

/**
 * How many numbers openai/text-embedding-3-small returns per text. The column
 * size is fixed to it, so using a model of another size needs a migration.
 */
export const EMBEDDING_DIMENSIONS = 1536;

/**
 * One section of a help document, with the embedding that makes it searchable.
 * The whole table is rebuilt from docs/support/ on every re-index, so rows are
 * never edited.
 */
@Entity({ name: 'chunks' })
@Unique('UQ_chunks_document_section', ['document', 'section'])
export class Chunk {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'PK_chunks' })
  id: string;

  /** The source file, e.g. errands.md */
  @Column({ type: 'text' })
  document: string;

  /** The document's title, shown as part of an answer's sources. */
  @Column({ type: 'text' })
  title: string;

  /** The section heading, shown as part of an answer's sources. */
  @Column({ type: 'text' })
  section: string;

  /** The FoC service the document describes, or `general`. */
  @Column({ type: 'text' })
  service: string;

  /** The section's words: what the chat model reads. */
  @Column({ type: 'text' })
  text: string;

  @Column({ type: 'vector', length: EMBEDDING_DIMENSIONS })
  embedding: number[];

  /** Vectors from different models cannot be compared. */
  @Column({ name: 'embedding_model', type: 'text' })
  embeddingModel: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
