import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Creates the account-initialization, inbox, and transactional-outbox schema. */
export class InitialPersistence1735689600000 implements MigrationInterface {
  name = 'InitialPersistence1735689600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "credit_accounts" (
        "user_id" uuid NOT NULL,
        "credit_balance" bigint NOT NULL,
        "reserved_balance" bigint NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "version" integer NOT NULL DEFAULT 1,
        CONSTRAINT "PK_credit_accounts" PRIMARY KEY ("user_id"),
        CONSTRAINT "CHK_credit_accounts_credit_balance" CHECK ("credit_balance" >= 0),
        CONSTRAINT "CHK_credit_accounts_reserved_balance" CHECK ("reserved_balance" >= 0)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "credit_allocations" (
        "id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "amount" bigint NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_credit_allocations" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_credit_allocations_amount" CHECK ("amount" > 0),
        CONSTRAINT "FK_credit_allocations_user" FOREIGN KEY ("user_id")
          REFERENCES "credit_accounts"("user_id") ON DELETE RESTRICT ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_credit_allocations_user"
      ON "credit_allocations" ("user_id")
    `);

    await queryRunner.query(`
      CREATE FUNCTION reject_credit_allocation_mutation()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'credit_allocations is append-only';
      END;
      $$ LANGUAGE plpgsql
    `);

    // Enforce immutable allocation history even when writes bypass TypeORM.
    await queryRunner.query(`
      CREATE TRIGGER "TRG_credit_allocations_immutable"
      BEFORE UPDATE OR DELETE ON "credit_allocations"
      FOR EACH ROW EXECUTE FUNCTION reject_credit_allocation_mutation()
    `);

    await queryRunner.query(`
      CREATE TABLE "inbox_events" (
        "event_id" uuid NOT NULL,
        "event_type" text NOT NULL,
        "payload_hash" char(64) NOT NULL,
        "received_at" timestamptz NOT NULL DEFAULT now(),
        "processed_at" timestamptz NOT NULL,
        "outcome_allocation_id" uuid NOT NULL,
        CONSTRAINT "PK_inbox_events" PRIMARY KEY ("event_id"),
        CONSTRAINT "FK_inbox_events_outcome" FOREIGN KEY ("outcome_allocation_id")
          REFERENCES "credit_allocations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "outbox_events" (
        "event_id" uuid NOT NULL,
        "event_type" text NOT NULL,
        "routing_key" text NOT NULL,
        "envelope" jsonb NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "published_at" timestamptz,
        "attempt_count" integer NOT NULL DEFAULT 0,
        "last_error" text,
        "claimed_by" text,
        "claimed_until" timestamptz,
        CONSTRAINT "PK_outbox_events" PRIMARY KEY ("event_id"),
        CONSTRAINT "CHK_outbox_events_attempt_count" CHECK ("attempt_count" >= 0)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_outbox_events_unpublished_created_at"
      ON "outbox_events" ("created_at")
      WHERE "published_at" IS NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "outbox_events"');
    await queryRunner.query('DROP TABLE "inbox_events"');
    await queryRunner.query(
      'DROP TRIGGER "TRG_credit_allocations_immutable" ON "credit_allocations"',
    );
    await queryRunner.query(
      'DROP FUNCTION reject_credit_allocation_mutation()',
    );
    await queryRunner.query('DROP TABLE "credit_allocations"');
    await queryRunner.query('DROP TABLE "credit_accounts"');
  }
}
