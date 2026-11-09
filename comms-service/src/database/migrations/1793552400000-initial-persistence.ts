import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Creates the complete live-chat, lifecycle-evidence, and archive foundation. */
export class InitialPersistence1793552400000 implements MigrationInterface {
  name = 'InitialPersistence1793552400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "inbox_events" (
        "event_id" uuid NOT NULL,
        "event_type" text NOT NULL,
        "routing_key" text NOT NULL,
        "publisher" text NOT NULL,
        "payload_hash" char(64) NOT NULL,
        "received_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_inbox_events" PRIMARY KEY ("event_id"),
        CONSTRAINT "CHK_inbox_events_identity" CHECK (
          char_length(btrim("event_type")) > 0
          AND char_length(btrim("routing_key")) > 0
          AND char_length(btrim("publisher")) > 0
        ),
        CONSTRAINT "CHK_inbox_events_payload_hash" CHECK (
          "payload_hash" ~ '^[0-9a-f]{64}$'
        )
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "chat_lifecycle_events" (
        "source_event_id" uuid NOT NULL,
        "kind" text NOT NULL,
        "errand_id" uuid NOT NULL,
        "requester_user_id" uuid,
        "courier_user_id" uuid,
        "occurred_at" timestamptz NOT NULL,
        "derived_close_at" timestamptz,
        "envelope" jsonb NOT NULL,
        "payload" jsonb NOT NULL,
        CONSTRAINT "PK_chat_lifecycle_events" PRIMARY KEY ("source_event_id"),
        CONSTRAINT "FK_chat_lifecycle_events_inbox" FOREIGN KEY ("source_event_id")
          REFERENCES "inbox_events"("event_id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "CHK_chat_lifecycle_events_kind" CHECK (
          "kind" IN (
            'ERRAND_ACCEPTED',
            'ERRAND_DELIVERED',
            'COURIER_CANCELLED',
            'ERRAND_CANCELLED'
          )
        ),
        CONSTRAINT "CHK_chat_lifecycle_events_participants" CHECK (
          (
            "kind" = 'ERRAND_CANCELLED'
            AND "requester_user_id" IS NULL
            AND "courier_user_id" IS NULL
          ) OR (
            "kind" <> 'ERRAND_CANCELLED'
            AND "requester_user_id" IS NOT NULL
            AND "courier_user_id" IS NOT NULL
            AND "requester_user_id" <> "courier_user_id"
          )
        ),
        CONSTRAINT "CHK_chat_lifecycle_events_deadline" CHECK (
          ("kind" = 'ERRAND_ACCEPTED' AND "derived_close_at" IS NULL)
          OR (
            "kind" = 'ERRAND_DELIVERED'
            AND "derived_close_at" = "occurred_at" + interval '3 hours'
          )
          OR (
            "kind" IN ('COURIER_CANCELLED', 'ERRAND_CANCELLED')
            AND "derived_close_at" = "occurred_at" + interval '30 minutes'
          )
        ),
        CONSTRAINT "CHK_chat_lifecycle_events_evidence" CHECK (
          jsonb_typeof("envelope") = 'object'
          AND jsonb_typeof("payload") = 'object'
        )
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_chat_lifecycle_events_errand_kind_occurred_event"
      ON "chat_lifecycle_events" (
        "errand_id", "kind", "occurred_at", "source_event_id"
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_chat_lifecycle_events_participants_errand_occurred"
      ON "chat_lifecycle_events" (
        "requester_user_id", "courier_user_id", "errand_id", "occurred_at"
      )
      WHERE "requester_user_id" IS NOT NULL AND "courier_user_id" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE FUNCTION reject_chat_lifecycle_event_mutation()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'chat_lifecycle_events is insert-only';
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TRG_chat_lifecycle_events_immutable"
      BEFORE UPDATE OR DELETE ON "chat_lifecycle_events"
      FOR EACH ROW EXECUTE FUNCTION reject_chat_lifecycle_event_mutation()
    `);

    await queryRunner.query(`
      CREATE TABLE "chats" (
        "id" uuid NOT NULL,
        "acceptance_event_id" uuid NOT NULL,
        "errand_id" uuid NOT NULL,
        "requester_user_id" uuid NOT NULL,
        "courier_user_id" uuid NOT NULL,
        "accepted_at" timestamptz NOT NULL,
        "state" text NOT NULL DEFAULT 'ACTIVE',
        "closes_at" timestamptz,
        "close_reason" text,
        "next_sequence" bigint NOT NULL DEFAULT 1,
        "archive_id" uuid,
        "archive_claim_token" uuid,
        "archive_claim_expires_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_chats" PRIMARY KEY ("id"),
        CONSTRAINT "FK_chats_acceptance_event" FOREIGN KEY ("acceptance_event_id")
          REFERENCES "chat_lifecycle_events"("source_event_id")
          ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "CHK_chats_participants" CHECK (
          "requester_user_id" <> "courier_user_id"
        ),
        CONSTRAINT "CHK_chats_next_sequence" CHECK ("next_sequence" > 0),
        CONSTRAINT "CHK_chats_close_reason" CHECK (
          "close_reason" IS NULL
          OR "close_reason" IN (
            'ERRAND_DELIVERED',
            'COURIER_CANCELLED',
            'ERRAND_CANCELLED'
          )
        ),
        CONSTRAINT "CHK_chats_state" CHECK (
          (
            "state" = 'ACTIVE'
            AND "closes_at" IS NULL
            AND "close_reason" IS NULL
            AND "archive_id" IS NULL
          ) OR (
            "state" = 'GRACE'
            AND "closes_at" IS NOT NULL
            AND "close_reason" IS NOT NULL
            AND "archive_id" IS NULL
          ) OR (
            "state" = 'ARCHIVED'
            AND "closes_at" IS NOT NULL
            AND "close_reason" IS NOT NULL
            AND "archive_id" IS NOT NULL
          )
        ),
        CONSTRAINT "CHK_chats_archive_claim" CHECK (
          (
            "archive_claim_token" IS NULL
            AND "archive_claim_expires_at" IS NULL
          ) OR (
            "archive_claim_token" IS NOT NULL
            AND "archive_claim_expires_at" IS NOT NULL
            AND "archive_claim_expires_at" > "created_at"
            AND "state" = 'GRACE'
            AND "archive_id" IS NULL
          )
        )
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_chats_acceptance_event"
      ON "chats" ("acceptance_event_id")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_chats_archive"
      ON "chats" ("archive_id") WHERE "archive_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_chats_requester_state_updated_id"
      ON "chats" ("requester_user_id", "state", "updated_at" DESC, "id" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_chats_courier_state_updated_id"
      ON "chats" ("courier_user_id", "state", "updated_at" DESC, "id" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_chats_errand_state"
      ON "chats" ("errand_id", "state")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_chats_due_grace"
      ON "chats" ("closes_at", "id")
      WHERE "state" = 'GRACE' AND "archive_id" IS NULL
    `);

    await queryRunner.query(`
      CREATE TABLE "messages" (
        "id" uuid NOT NULL,
        "chat_id" uuid NOT NULL,
        "sequence" bigint NOT NULL,
        "sender_id" uuid NOT NULL,
        "client_message_id" uuid NOT NULL,
        "content" text NOT NULL,
        "committed_at" timestamptz NOT NULL DEFAULT now(),
        "read_at" timestamptz,
        CONSTRAINT "PK_messages" PRIMARY KEY ("id"),
        CONSTRAINT "FK_messages_chat" FOREIGN KEY ("chat_id")
          REFERENCES "chats"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "CHK_messages_sequence" CHECK ("sequence" > 0),
        CONSTRAINT "CHK_messages_content" CHECK (
          char_length(btrim("content")) > 0
          AND char_length("content") <= 4000
        ),
        CONSTRAINT "CHK_messages_read_at" CHECK (
          "read_at" IS NULL OR "read_at" >= "committed_at"
        )
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_messages_chat_sequence"
      ON "messages" ("chat_id", "sequence")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_messages_chat_sender_client"
      ON "messages" ("chat_id", "sender_id", "client_message_id")
    `);

    await queryRunner.query(`
      CREATE TABLE "chat_archives" (
        "id" uuid NOT NULL,
        "chat_id" uuid NOT NULL,
        "errand_id" uuid NOT NULL,
        "requester_user_id" uuid NOT NULL,
        "courier_user_id" uuid NOT NULL,
        "archived_at" timestamptz NOT NULL DEFAULT now(),
        "schema_version" smallint NOT NULL DEFAULT 1,
        "snapshot" jsonb NOT NULL,
        CONSTRAINT "PK_chat_archives" PRIMARY KEY ("id"),
        CONSTRAINT "FK_chat_archives_chat" FOREIGN KEY ("chat_id")
          REFERENCES "chats"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "CHK_chat_archives_participants" CHECK (
          "requester_user_id" <> "courier_user_id"
        ),
        CONSTRAINT "CHK_chat_archives_schema_version" CHECK (
          "schema_version" = 1
        ),
        CONSTRAINT "CHK_chat_archives_snapshot" CHECK (
          jsonb_typeof("snapshot") = 'object'
          AND ("snapshot" ->> 'schemaVersion') = "schema_version"::text
        )
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_chat_archives_chat"
      ON "chat_archives" ("chat_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_chat_archives_requester_archived_id"
      ON "chat_archives" ("requester_user_id", "archived_at" DESC, "id" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_chat_archives_courier_archived_id"
      ON "chat_archives" ("courier_user_id", "archived_at" DESC, "id" DESC)
    `);

    await queryRunner.query(`
      ALTER TABLE "chats"
      ADD CONSTRAINT "FK_chats_archive" FOREIGN KEY ("archive_id")
        REFERENCES "chat_archives"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      CREATE FUNCTION reject_chat_archive_mutation()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'chat_archives is immutable';
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TRG_chat_archives_immutable"
      BEFORE UPDATE OR DELETE ON "chat_archives"
      FOR EACH ROW EXECUTE FUNCTION reject_chat_archive_mutation()
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "chats" DROP CONSTRAINT "FK_chats_archive"',
    );
    await queryRunner.query(
      'DROP TRIGGER "TRG_chat_archives_immutable" ON "chat_archives"',
    );
    await queryRunner.query('DROP FUNCTION reject_chat_archive_mutation()');
    await queryRunner.query('DROP TABLE "chat_archives"');
    await queryRunner.query('DROP TABLE "messages"');
    await queryRunner.query('DROP TABLE "chats"');
    await queryRunner.query(
      'DROP TRIGGER "TRG_chat_lifecycle_events_immutable" ON "chat_lifecycle_events"',
    );
    await queryRunner.query(
      'DROP FUNCTION reject_chat_lifecycle_event_mutation()',
    );
    await queryRunner.query('DROP TABLE "chat_lifecycle_events"');
    await queryRunner.query('DROP TABLE "inbox_events"');
  }
}
