import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Opening hours (F2): a supplier is open around the clock (a flag, F2.2) or
 * has weekly intervals in supplier_opening_intervals, one row per interval
 * (F2.1). Having neither means no fixed opening hours (F1.2.8).
 */
export class AddOpeningHours1791072000000 implements MigrationInterface {
  name = 'AddOpeningHours1791072000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "suppliers"
        ADD "open_24_hours" boolean NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      CREATE TABLE "supplier_opening_intervals" (
        "supplier_id" uuid NOT NULL,
        "day" smallint NOT NULL,
        "opens_at" smallint NOT NULL,
        "closes_at" smallint NOT NULL,
        CONSTRAINT "PK_supplier_opening_intervals" PRIMARY KEY ("supplier_id", "day", "opens_at"),
        CONSTRAINT "CHK_supplier_opening_intervals_day" CHECK (day BETWEEN 0 AND 6),
        CONSTRAINT "CHK_supplier_opening_intervals_opens_at" CHECK (opens_at BETWEEN 0 AND 1439),
        CONSTRAINT "CHK_supplier_opening_intervals_closes_at" CHECK (closes_at BETWEEN 0 AND 1439),
        CONSTRAINT "CHK_supplier_opening_intervals_differ" CHECK (opens_at <> closes_at),
        CONSTRAINT "FK_supplier_opening_intervals_supplier" FOREIGN KEY ("supplier_id")
          REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "supplier_opening_intervals"`);
    await queryRunner.query(
      `ALTER TABLE "suppliers" DROP COLUMN "open_24_hours"`,
    );
  }
}
