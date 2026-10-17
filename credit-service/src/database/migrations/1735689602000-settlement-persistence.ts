import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Allows a cancellation to wait for reservation context without weakening terminal settlement rows. */
export class SettlementPersistence1735689602000
  implements MigrationInterface
{
  name = 'SettlementPersistence1735689602000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "credit_operations"
      DROP CONSTRAINT "CHK_credit_operations_amount",
      DROP CONSTRAINT "CHK_credit_operations_requester",
      ALTER COLUMN "amount" DROP NOT NULL,
      ADD CONSTRAINT "CHK_credit_operations_amount" CHECK (
        ("amount" IS NOT NULL AND "amount" > 0)
        OR (
          "operation_type" = 'RELEASE'
          AND "status" = 'PENDING'
          AND "amount" IS NULL
        )
      ),
      ADD CONSTRAINT "CHK_credit_operations_requester" CHECK (
        "operation_type" = 'ADJUST'
        OR "requester_user_id" IS NOT NULL
        OR (
          "operation_type" = 'RELEASE'
          AND "status" = 'PENDING'
        )
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM "credit_operations"
          WHERE "amount" IS NULL
             OR (
               "requester_user_id" IS NULL
               AND "operation_type" <> 'ADJUST'
             )
        ) THEN
          RAISE EXCEPTION
            'Cannot revert settlement persistence while unresolved release operations exist';
        END IF;
      END
      $$
    `);

    await queryRunner.query(`
      ALTER TABLE "credit_operations"
      DROP CONSTRAINT "CHK_credit_operations_amount",
      DROP CONSTRAINT "CHK_credit_operations_requester",
      ALTER COLUMN "amount" SET NOT NULL,
      ADD CONSTRAINT "CHK_credit_operations_amount" CHECK ("amount" > 0),
      ADD CONSTRAINT "CHK_credit_operations_requester" CHECK (
        "operation_type" = 'ADJUST' OR "requester_user_id" IS NOT NULL
      )
    `);
  }
}
