import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Brands (F3): a controlled list of businesses with several outlets, and an
 * optional brand on each supplier (F1.2.10, F3.4). A retired brand stays on
 * the suppliers that hold it (F1.8), so the foreign key restricts deletion.
 */
export class AddBrands1791158400000 implements MigrationInterface {
  name = 'AddBrands1791158400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "brands" (
        "id" uuid NOT NULL,
        "name" varchar(100) NOT NULL,
        "name_key" text NOT NULL,
        "retired_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_brands" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_brands_name" CHECK (length(btrim(name)) > 0)
      )
    `);
    // Unique among non-retired brands only (F3.2).
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_brands_name_key_active"
      ON "brands" ("name_key") WHERE (retired_at IS NULL)
    `);
    await queryRunner.query(`
      ALTER TABLE "suppliers" ADD "brand_id" uuid
    `);
    await queryRunner.query(`
      ALTER TABLE "suppliers"
        ADD CONSTRAINT "FK_suppliers_brand" FOREIGN KEY ("brand_id")
        REFERENCES "brands"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_suppliers_brand_id" ON "suppliers" ("brand_id")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_suppliers_brand_id"`);
    await queryRunner.query(
      `ALTER TABLE "suppliers" DROP CONSTRAINT "FK_suppliers_brand"`,
    );
    await queryRunner.query(`ALTER TABLE "suppliers" DROP COLUMN "brand_id"`);
    await queryRunner.query(`DROP TABLE "brands"`);
  }
}
