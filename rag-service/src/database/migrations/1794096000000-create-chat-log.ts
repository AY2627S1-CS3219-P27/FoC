import type { MigrationInterface, QueryRunner } from 'typeorm';

/** One row per accepted question: the rate limit and the record of answers. */
export class CreateChatLog1794096000000 implements MigrationInterface {
  name = 'CreateChatLog1794096000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "chat_log" (
        "id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "question" text NOT NULL,
        "outcome" text NOT NULL DEFAULT 'pending',
        "sections" jsonb NOT NULL DEFAULT '[]',
        "cutoff_applied" boolean NOT NULL DEFAULT false,
        "embed_ms" integer,
        "search_ms" integer,
        "generate_ms" integer,
        "prompt_tokens" integer,
        "completion_tokens" integer,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_chat_log" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_chat_log_outcome" CHECK (outcome IN ('pending', 'answered', 'no_match', 'refused', 'error'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_chat_log_user_created" ON "chat_log" ("user_id", "created_at")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "chat_log"`);
  }
}
