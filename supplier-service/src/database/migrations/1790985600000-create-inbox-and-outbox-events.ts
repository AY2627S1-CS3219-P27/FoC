import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the tables for answering Order Service's supplier-validation
 * requests over RabbitMQ (F15.7.3): outbox_events holds replies waiting to be
 * published (the table @foc/outbox expects, as in credit-service), and
 * inbox_events records each answered request with the reply it produced.
 */
export class CreateInboxAndOutboxEvents1790985600000 implements MigrationInterface {
  name = 'CreateInboxAndOutboxEvents1790985600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "outbox_events" (
        "event_id" uuid NOT NULL,
        "event_type" text NOT NULL,
        "routing_key" text NOT NULL,
        "envelope" jsonb NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "next_attempt_at" timestamptz NOT NULL DEFAULT now(),
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
      CREATE INDEX "IDX_outbox_events_unpublished_next_attempt_at_created_at"
      ON "outbox_events" ("next_attempt_at", "created_at", "event_id")
      WHERE "published_at" IS NULL
    `);

    await queryRunner.query(`
      CREATE TABLE "inbox_events" (
        "event_id" uuid NOT NULL,
        "event_type" text NOT NULL,
        "payload_hash" char(64) NOT NULL,
        "received_at" timestamptz NOT NULL DEFAULT now(),
        "processed_at" timestamptz NOT NULL,
        "reply_event_id" uuid NOT NULL,
        CONSTRAINT "PK_inbox_events" PRIMARY KEY ("event_id"),
        CONSTRAINT "FK_inbox_events_reply" FOREIGN KEY ("reply_event_id")
          REFERENCES "outbox_events"("event_id") ON DELETE RESTRICT ON UPDATE NO ACTION
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "inbox_events"`);
    await queryRunner.query(`DROP TABLE "outbox_events"`);
  }
}
