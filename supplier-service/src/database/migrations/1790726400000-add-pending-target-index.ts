import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * At most one Pending request of each type per supplier: one update (F8.3)
 * and, later, one status change (F9.3.2). Creation requests have no target
 * supplier and are covered by UQ_supplier_requests_pending_create.
 */
export class AddPendingTargetIndex1790726400000 implements MigrationInterface {
  name = 'AddPendingTargetIndex1790726400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_supplier_requests_pending_target"
      ON "supplier_requests" ("supplier_id", "type")
      WHERE type <> 'Create' AND state = 'Pending'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_supplier_requests_pending_target"`);
  }
}
