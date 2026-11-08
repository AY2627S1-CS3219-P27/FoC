import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Adds durable, attempt-scoped settlement operations with up to two ledger legs. */
export class CreditSettlement1735689603000 implements MigrationInterface {
  name = 'CreditSettlement1735689603000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "credit_operations"
      DROP CONSTRAINT "CHK_credit_operations_type",
      DROP CONSTRAINT "CHK_credit_operations_participants",
      DROP CONSTRAINT "CHK_credit_operations_outcome",
      ADD COLUMN "settlement_attempt" bigint,
      ADD COLUMN "requester_amount" bigint,
      ADD COLUMN "courier_amount" bigint,
      ADD COLUMN "requester_transaction_id" uuid,
      ADD COLUMN "courier_transaction_id" uuid,
      ADD CONSTRAINT "CHK_credit_operations_type" CHECK (
        "operation_type" IN ('RESERVE', 'ADJUST', 'TRANSFER', 'RELEASE', 'SETTLEMENT')
      ),
      ADD CONSTRAINT "CHK_credit_operations_participants" CHECK (
        (
          "operation_type" IN ('TRANSFER', 'SETTLEMENT')
          AND "courier_user_id" IS NOT NULL
          AND "courier_user_id" <> "requester_user_id"
        ) OR (
          "operation_type" NOT IN ('TRANSFER', 'SETTLEMENT')
          AND "courier_user_id" IS NULL
        )
      ),
      ADD CONSTRAINT "CHK_credit_operations_settlement_command" CHECK (
        (
          "operation_type" = 'SETTLEMENT'
          AND "settlement_attempt" IS NOT NULL
          AND "settlement_attempt" > 0
          AND "requester_amount" IS NOT NULL
          AND "requester_amount" >= 0
          AND "courier_amount" IS NOT NULL
          AND "courier_amount" >= 0
          AND "requester_amount" + "courier_amount" = "amount"
          AND "requester_amount" + "courier_amount" > 0
        ) OR (
          "operation_type" <> 'SETTLEMENT'
          AND "settlement_attempt" IS NULL
          AND "requester_amount" IS NULL
          AND "courier_amount" IS NULL
        )
      ),
      ADD CONSTRAINT "CHK_credit_operations_outcome" CHECK (
        (
          "status" = 'PENDING'
          AND "rejection_reason" IS NULL
          AND "completion_transaction_id" IS NULL
          AND "requester_transaction_id" IS NULL
          AND "courier_transaction_id" IS NULL
          AND "outcome_outbox_event_id" IS NULL
        ) OR (
          "status" = 'SUCCEEDED'
          AND "rejection_reason" IS NULL
          AND "outcome_outbox_event_id" IS NOT NULL
          AND (
            (
              "operation_type" <> 'SETTLEMENT'
              AND "completion_transaction_id" IS NOT NULL
              AND "requester_transaction_id" IS NULL
              AND "courier_transaction_id" IS NULL
            ) OR (
              "operation_type" = 'SETTLEMENT'
              AND "completion_transaction_id" IS NULL
              AND (("requester_amount" = 0 AND "requester_transaction_id" IS NULL) OR ("requester_amount" > 0 AND "requester_transaction_id" IS NOT NULL))
              AND (("courier_amount" = 0 AND "courier_transaction_id" IS NULL) OR ("courier_amount" > 0 AND "courier_transaction_id" IS NOT NULL))
            )
          )
        ) OR (
          "status" = 'REJECTED'
          AND "rejection_reason" IS NOT NULL
          AND "completion_transaction_id" IS NULL
          AND "requester_transaction_id" IS NULL
          AND "courier_transaction_id" IS NULL
          AND "outcome_outbox_event_id" IS NOT NULL
        )
      ),
      ADD CONSTRAINT "FK_credit_operations_requester_transaction"
        FOREIGN KEY ("requester_transaction_id") REFERENCES "credit_transactions"("id")
        ON DELETE RESTRICT ON UPDATE NO ACTION,
      ADD CONSTRAINT "FK_credit_operations_courier_transaction"
        FOREIGN KEY ("courier_transaction_id") REFERENCES "credit_transactions"("id")
        ON DELETE RESTRICT ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_credit_operations_settlement_attempt"
      ON "credit_operations" ("errand_id", "settlement_attempt")
      WHERE "operation_type" = 'SETTLEMENT'
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_credit_operations_requester_transaction"
      ON "credit_operations" ("requester_transaction_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_credit_operations_courier_transaction"
      ON "credit_operations" ("courier_transaction_id")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM "credit_operations" WHERE "operation_type" = 'SETTLEMENT') THEN
          RAISE EXCEPTION 'Cannot revert credit settlement while settlement operations exist';
        END IF;
      END
      $$
    `);
    await queryRunner.query('DROP INDEX "IDX_credit_operations_courier_transaction"');
    await queryRunner.query('DROP INDEX "IDX_credit_operations_requester_transaction"');
    await queryRunner.query('DROP INDEX "UQ_credit_operations_settlement_attempt"');
    await queryRunner.query(`
      ALTER TABLE "credit_operations"
      DROP CONSTRAINT "FK_credit_operations_courier_transaction",
      DROP CONSTRAINT "FK_credit_operations_requester_transaction",
      DROP CONSTRAINT "CHK_credit_operations_outcome",
      DROP CONSTRAINT "CHK_credit_operations_settlement_command",
      DROP CONSTRAINT "CHK_credit_operations_participants",
      DROP CONSTRAINT "CHK_credit_operations_type",
      DROP COLUMN "courier_transaction_id",
      DROP COLUMN "requester_transaction_id",
      DROP COLUMN "courier_amount",
      DROP COLUMN "requester_amount",
      DROP COLUMN "settlement_attempt",
      ADD CONSTRAINT "CHK_credit_operations_type" CHECK (
        "operation_type" IN ('RESERVE', 'ADJUST', 'TRANSFER', 'RELEASE')
      ),
      ADD CONSTRAINT "CHK_credit_operations_participants" CHECK (
        ("operation_type" = 'TRANSFER' AND "courier_user_id" IS NOT NULL AND "courier_user_id" <> "requester_user_id")
        OR ("operation_type" <> 'TRANSFER' AND "courier_user_id" IS NULL)
      ),
      ADD CONSTRAINT "CHK_credit_operations_outcome" CHECK (
        ("status" = 'PENDING' AND "rejection_reason" IS NULL AND "completion_transaction_id" IS NULL AND "outcome_outbox_event_id" IS NULL)
        OR ("status" = 'SUCCEEDED' AND "rejection_reason" IS NULL AND "completion_transaction_id" IS NOT NULL AND "outcome_outbox_event_id" IS NOT NULL)
        OR ("status" = 'REJECTED' AND "rejection_reason" IS NOT NULL AND "completion_transaction_id" IS NULL AND "outcome_outbox_event_id" IS NOT NULL)
      )
    `);
  }
}
