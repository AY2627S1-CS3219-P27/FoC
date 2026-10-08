import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Adds reservation operations, financial state, the movement ledger, and inbox outcomes. */
export class CreditReservations1735689601000 implements MigrationInterface {
  name = 'CreditReservations1735689601000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "credit_transactions" (
        "id" uuid NOT NULL,
        "type" text NOT NULL,
        "amount" bigint NOT NULL,
        "origin_balance_type" text NOT NULL,
        "destination_balance_type" text NOT NULL,
        "origin_user_id" uuid NOT NULL,
        "destination_user_id" uuid NOT NULL,
        "errand_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_credit_transactions" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_credit_transactions_type"
          CHECK ("type" IN ('RESERVATION', 'RESERVATION_ADJUSTMENT', 'TRANSFER', 'RELEASE')),
        CONSTRAINT "CHK_credit_transactions_amount" CHECK ("amount" > 0),
        CONSTRAINT "CHK_credit_transactions_origin_balance_type"
          CHECK ("origin_balance_type" IN ('CREDIT_BALANCE', 'RESERVED_BALANCE')),
        CONSTRAINT "CHK_credit_transactions_destination_balance_type"
          CHECK ("destination_balance_type" IN ('CREDIT_BALANCE', 'RESERVED_BALANCE')),
        CONSTRAINT "CHK_credit_transactions_distinct_balance_types"
          CHECK ("origin_balance_type" <> "destination_balance_type"),
        CONSTRAINT "CHK_credit_transactions_user_relationship"
          CHECK (
            ("type" = 'TRANSFER' AND "origin_user_id" <> "destination_user_id")
            OR ("type" <> 'TRANSFER' AND "origin_user_id" = "destination_user_id")
          ),
        CONSTRAINT "CHK_credit_transactions_direction"
          CHECK (
            (
              "type" = 'RESERVATION'
              AND "origin_balance_type" = 'CREDIT_BALANCE'
              AND "destination_balance_type" = 'RESERVED_BALANCE'
            )
            OR "type" = 'RESERVATION_ADJUSTMENT'
            OR (
              "type" IN ('TRANSFER', 'RELEASE')
              AND "origin_balance_type" = 'RESERVED_BALANCE'
              AND "destination_balance_type" = 'CREDIT_BALANCE'
            )
          ),
        CONSTRAINT "FK_credit_transactions_origin_user" FOREIGN KEY ("origin_user_id")
          REFERENCES "credit_accounts"("user_id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "FK_credit_transactions_destination_user" FOREIGN KEY ("destination_user_id")
          REFERENCES "credit_accounts"("user_id") ON DELETE RESTRICT ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_credit_transactions_errand_created_at_id"
      ON "credit_transactions" ("errand_id", "created_at", "id")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_credit_transactions_origin_user_created_at_id"
      ON "credit_transactions" ("origin_user_id", "created_at", "id")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_credit_transactions_destination_user_created_at_id"
      ON "credit_transactions" ("destination_user_id", "created_at", "id")
    `);

    await queryRunner.query(`
      CREATE FUNCTION reject_credit_transaction_mutation()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'credit_transactions is append-only';
      END;
      $$ LANGUAGE plpgsql
    `);

    await queryRunner.query(`
      CREATE TRIGGER "TRG_credit_transactions_immutable"
      BEFORE UPDATE OR DELETE ON "credit_transactions"
      FOR EACH ROW EXECUTE FUNCTION reject_credit_transaction_mutation()
    `);

    await queryRunner.query(`
      CREATE TABLE "credit_reservations" (
        "id" uuid NOT NULL,
        "errand_id" uuid NOT NULL,
        "requester_user_id" uuid NOT NULL,
        "reserved_amount" bigint NOT NULL,
        "status" text NOT NULL,
        "latest_transaction_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_credit_reservations" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_credit_reservations_reserved_amount"
          CHECK ("reserved_amount" > 0),
        CONSTRAINT "CHK_credit_reservations_status"
          CHECK ("status" IN ('ACTIVE', 'CONSUMED', 'RELEASED')),
        CONSTRAINT "FK_credit_reservations_requester" FOREIGN KEY ("requester_user_id")
          REFERENCES "credit_accounts"("user_id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "FK_credit_reservations_latest_transaction" FOREIGN KEY ("latest_transaction_id")
          REFERENCES "credit_transactions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_credit_reservations_errand"
      ON "credit_reservations" ("errand_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_credit_reservations_active_requester"
      ON "credit_reservations" ("requester_user_id")
      WHERE "status" = 'ACTIVE'
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_credit_reservations_latest_transaction"
      ON "credit_reservations" ("latest_transaction_id")
    `);

    await queryRunner.query(`
      CREATE TABLE "credit_operations" (
        "id" uuid NOT NULL,
        "errand_id" uuid NOT NULL,
        "operation_type" text NOT NULL,
        "status" text NOT NULL,
        "requester_user_id" uuid NOT NULL,
        "courier_user_id" uuid,
        "amount" bigint NOT NULL,
        "request_payload_hash" char(64) NOT NULL,
        "attempt_count" integer NOT NULL DEFAULT 0,
        "next_attempt_at" timestamptz NOT NULL DEFAULT now(),
        "claimed_by" text,
        "claimed_until" timestamptz,
        "last_error" text,
        "rejection_reason" text,
        "completion_transaction_id" uuid,
        "outcome_outbox_event_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_credit_operations" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_credit_operations_type"
          CHECK ("operation_type" IN ('RESERVE', 'TRANSFER', 'RELEASE')),
        CONSTRAINT "CHK_credit_operations_status"
          CHECK ("status" IN ('PENDING', 'SUCCEEDED', 'REJECTED')),
        CONSTRAINT "CHK_credit_operations_amount" CHECK ("amount" > 0),
        CONSTRAINT "CHK_credit_operations_attempt_count" CHECK ("attempt_count" >= 0),
        CONSTRAINT "CHK_credit_operations_participants" CHECK (
          (
            "operation_type" = 'TRANSFER'
            AND "courier_user_id" IS NOT NULL
            AND "courier_user_id" <> "requester_user_id"
          )
          OR (
            "operation_type" <> 'TRANSFER'
            AND "courier_user_id" IS NULL
          )
        ),
        CONSTRAINT "CHK_credit_operations_claim" CHECK (
          (("claimed_by" IS NULL) = ("claimed_until" IS NULL))
          AND ("claimed_by" IS NULL OR "status" = 'PENDING')
        ),
        CONSTRAINT "CHK_credit_operations_outcome" CHECK (
          (
            "status" = 'PENDING'
            AND "rejection_reason" IS NULL
            AND "completion_transaction_id" IS NULL
            AND "outcome_outbox_event_id" IS NULL
          )
          OR (
            "status" = 'SUCCEEDED'
            AND "rejection_reason" IS NULL
            AND "completion_transaction_id" IS NOT NULL
            AND "outcome_outbox_event_id" IS NOT NULL
          )
          OR (
            "status" = 'REJECTED'
            AND "rejection_reason" IS NOT NULL
            AND "completion_transaction_id" IS NULL
            AND "outcome_outbox_event_id" IS NOT NULL
          )
        ),
        CONSTRAINT "FK_credit_operations_completion_transaction"
          FOREIGN KEY ("completion_transaction_id")
          REFERENCES "credit_transactions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "FK_credit_operations_outcome_outbox"
          FOREIGN KEY ("outcome_outbox_event_id")
          REFERENCES "outbox_events"("event_id") ON DELETE RESTRICT ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_credit_operations_errand_type"
      ON "credit_operations" ("errand_id", "operation_type")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_credit_operations_pending_due"
      ON "credit_operations" ("next_attempt_at", "created_at", "id")
      WHERE "status" = 'PENDING'
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_credit_operations_pending_claim_expiry"
      ON "credit_operations" ("claimed_until", "id")
      WHERE "status" = 'PENDING' AND "claimed_until" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_credit_operations_completion_transaction"
      ON "credit_operations" ("completion_transaction_id")
      WHERE "completion_transaction_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_credit_operations_outcome_outbox"
      ON "credit_operations" ("outcome_outbox_event_id")
      WHERE "outcome_outbox_event_id" IS NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "inbox_events"
      ALTER COLUMN "outcome_allocation_id" DROP NOT NULL,
      ADD COLUMN "outcome_operation_id" uuid,
      ADD COLUMN "outcome_transaction_id" uuid,
      ADD COLUMN "outcome_outbox_event_id" uuid,
      ADD CONSTRAINT "FK_inbox_events_outcome_operation"
        FOREIGN KEY ("outcome_operation_id") REFERENCES "credit_operations"("id")
        ON DELETE RESTRICT ON UPDATE NO ACTION,
      ADD CONSTRAINT "FK_inbox_events_outcome_transaction"
        FOREIGN KEY ("outcome_transaction_id") REFERENCES "credit_transactions"("id")
        ON DELETE RESTRICT ON UPDATE NO ACTION,
      ADD CONSTRAINT "FK_inbox_events_outcome_outbox"
        FOREIGN KEY ("outcome_outbox_event_id") REFERENCES "outbox_events"("event_id")
        ON DELETE RESTRICT ON UPDATE NO ACTION,
      ADD CONSTRAINT "CHK_inbox_events_has_outcome" CHECK (
        "outcome_allocation_id" IS NOT NULL
        OR "outcome_operation_id" IS NOT NULL
        OR "outcome_transaction_id" IS NOT NULL
        OR "outcome_outbox_event_id" IS NOT NULL
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "inbox_events"
      DROP CONSTRAINT "CHK_inbox_events_has_outcome",
      DROP CONSTRAINT "FK_inbox_events_outcome_operation",
      DROP CONSTRAINT "FK_inbox_events_outcome_outbox",
      DROP CONSTRAINT "FK_inbox_events_outcome_transaction",
      DROP COLUMN "outcome_outbox_event_id",
      DROP COLUMN "outcome_transaction_id",
      DROP COLUMN "outcome_operation_id",
      ALTER COLUMN "outcome_allocation_id" SET NOT NULL
    `);
    await queryRunner.query('DROP TABLE "credit_operations"');
    await queryRunner.query('DROP TABLE "credit_reservations"');
    await queryRunner.query(
      'DROP TRIGGER "TRG_credit_transactions_immutable" ON "credit_transactions"',
    );
    await queryRunner.query(
      'DROP FUNCTION reject_credit_transaction_mutation()',
    );
    await queryRunner.query('DROP TABLE "credit_transactions"');
  }
}
