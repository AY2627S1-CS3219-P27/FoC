import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * user-service now identifies users by UUID (#611), and the access token's
 * `sub` is one, so request user ids become `uuid` instead of `text`. A row
 * holding an old numeric id cannot be converted and makes the migration
 * fail, changing nothing, rather than silently losing who acted.
 */
export class StoreUserIdsAsUuid1790899200000 implements MigrationInterface {
  name = 'StoreUserIdsAsUuid1790899200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "supplier_requests"
        ALTER COLUMN "submitted_by" TYPE uuid USING "submitted_by"::uuid,
        ALTER COLUMN "resolved_by" TYPE uuid USING "resolved_by"::uuid
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "supplier_requests"
        ALTER COLUMN "submitted_by" TYPE text,
        ALTER COLUMN "resolved_by" TYPE text
    `);
  }
}
