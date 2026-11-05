import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Flags the one placeholder building a map-pin errand points at. Adds the
 * column only; the row itself is seeded at startup. Every existing building
 * stays false.
 */
export class AddBuildingAllowsPin1791244800000 implements MigrationInterface {
  name = 'AddBuildingAllowsPin1791244800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "buildings" ADD "allows_pin" boolean NOT NULL DEFAULT false
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "buildings" DROP COLUMN "allows_pin"`);
  }
}
