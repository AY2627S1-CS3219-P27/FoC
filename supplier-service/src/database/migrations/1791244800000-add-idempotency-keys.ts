import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Idempotency keys for requests that create a record (F14.2): the same user
 * repeating a key within 24 hours with the same payload gets the original
 * outcome (F14.2.1); with a different payload, a refusal (F14.2.2).
 */
export class AddIdempotencyKeys1791244800000 implements MigrationInterface {
  name = 'AddIdempotencyKeys1791244800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "idempotency_keys" (
        "user_id" uuid NOT NULL,
        "key" varchar(255) NOT NULL,
        "claim_id" uuid NOT NULL,
        "fingerprint" varchar(64) NOT NULL,
        "status_code" smallint,
        "headers" jsonb,
        "body" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "completed_at" timestamptz,
        CONSTRAINT "PK_idempotency_keys" PRIMARY KEY ("user_id", "key"),
        CONSTRAINT "CHK_idempotency_keys_key" CHECK (length(key) BETWEEN 1 AND 255),
        CONSTRAINT "CHK_idempotency_keys_completed" CHECK ((completed_at IS NULL) = (status_code IS NULL))
      )
    `);
    // Old keys are purged by age.
    await queryRunner.query(`
      CREATE INDEX "IDX_idempotency_keys_created_at"
      ON "idempotency_keys" ("created_at")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "idempotency_keys"`);
  }
}
