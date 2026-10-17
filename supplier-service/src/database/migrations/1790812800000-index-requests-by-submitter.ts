import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A user's own requests are listed newest first (F6.5), so the submitter
 * index also orders by submission time.
 */
export class IndexRequestsBySubmitter1790812800000 implements MigrationInterface {
  name = 'IndexRequestsBySubmitter1790812800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_supplier_requests_submitted_by"`);
    await queryRunner.query(`
      CREATE INDEX "IDX_supplier_requests_submitted_by"
      ON "supplier_requests" ("submitted_by", "submitted_at")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_supplier_requests_submitted_by"`);
    await queryRunner.query(`
      CREATE INDEX "IDX_supplier_requests_submitted_by"
      ON "supplier_requests" ("submitted_by")
    `);
  }
}
