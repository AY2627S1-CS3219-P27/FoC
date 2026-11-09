import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the notification-service schema.
 *
 * Database objects are created idempotently because development stacks that
 * predate the migration discipline already hold a synchronize-created
 * `subscriptions` table. Fresh databases get exactly the same shape.
 */
export class InitialNotificationPersistence1794000000000 implements MigrationInterface {
  name = 'InitialNotificationPersistence1794000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "subscriptions_channel_enum" AS ENUM ('web_push');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "subscriptions_status_enum" AS ENUM ('active', 'inactive');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "notification_deliveries_status_enum" AS ENUM (
          'pending', 'sent', 'abandoned'
        );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "subscriptions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "channel" "subscriptions_channel_enum" NOT NULL,
        "endpoint" text NOT NULL,
        "credentials" jsonb NOT NULL,
        "expiration_time" timestamptz,
        "status" "subscriptions_status_enum" NOT NULL DEFAULT 'active',
        "deactivated_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_subscriptions" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_subscriptions_user_id_endpoint"
      ON "subscriptions" ("user_id", "endpoint")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "inbox_events" (
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
      CREATE TABLE IF NOT EXISTS "notification_deliveries" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "event_id" uuid NOT NULL,
        "subscription_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "status" "notification_deliveries_status_enum" NOT NULL
          DEFAULT 'pending',
        "message" jsonb NOT NULL,
        "attempts" integer NOT NULL DEFAULT 0,
        "last_error" text,
        "sent_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_notification_deliveries" PRIMARY KEY ("id"),
        CONSTRAINT "FK_notification_deliveries_event" FOREIGN KEY ("event_id")
          REFERENCES "inbox_events"("event_id") ON DELETE CASCADE,
        CONSTRAINT "FK_notification_deliveries_subscription"
          FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id")
          ON DELETE CASCADE,
        CONSTRAINT "CHK_notification_deliveries_attempts" CHECK (
          "attempts" >= 0
        ),
        CONSTRAINT "CHK_notification_deliveries_message" CHECK (
          jsonb_typeof("message") = 'object'
        )
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS
        "UQ_notification_deliveries_event_subscription"
      ON "notification_deliveries" ("event_id", "subscription_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_notification_deliveries_event_status"
      ON "notification_deliveries" ("event_id", "status")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "notification_deliveries"');
    await queryRunner.query('DROP TABLE IF EXISTS "inbox_events"');
    await queryRunner.query('DROP TABLE IF EXISTS "subscriptions"');
    await queryRunner.query(
      'DROP TYPE IF EXISTS "notification_deliveries_status_enum"',
    );
    await queryRunner.query('DROP TYPE IF EXISTS "subscriptions_status_enum"');
    await queryRunner.query('DROP TYPE IF EXISTS "subscriptions_channel_enum"');
  }
}
