import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The searchable sections of the help documents. There is deliberately no
 * vector index: with a couple of hundred rows, comparing against every row is
 * instant and exact, while the approximate indexes only pay off at far larger
 * sizes.
 */
export class CreateChunks1794009600000 implements MigrationInterface {
  name = 'CreateChunks1794009600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "chunks" (
        "id" uuid NOT NULL,
        "document" text NOT NULL,
        "title" text NOT NULL,
        "section" text NOT NULL,
        "service" text NOT NULL,
        "text" text NOT NULL,
        "embedding" vector(1536) NOT NULL,
        "embedding_model" text NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_chunks" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_chunks_document_section" UNIQUE ("document", "section")
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "chunks"`);
  }
}
