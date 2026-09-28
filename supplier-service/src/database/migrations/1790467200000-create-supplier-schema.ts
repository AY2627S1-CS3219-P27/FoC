import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the supplier data model: buildings (F4), categories (F11),
 * suppliers (F1) and the supplier-category links. Every rule the database
 * can express is a named constraint here, so a rejected write names the rule
 * it broke.
 */
export class CreateSupplierSchema1790467200000 implements MigrationInterface {
  name = 'CreateSupplierSchema1790467200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "supplier_kind" AS ENUM ('Store', 'Facility', 'Landmark')
    `);
    await queryRunner.query(`
      CREATE TYPE "supplier_status" AS ENUM ('Active', 'Inactive')
    `);

    await queryRunner.query(`
      CREATE TABLE "buildings" (
        "id" uuid NOT NULL,
        "canonical_name" varchar(100) NOT NULL,
        "short_name" varchar(20) NOT NULL,
        "aliases" text[] NOT NULL,
        "latitude" double precision NOT NULL,
        "longitude" double precision NOT NULL,
        "retired_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_buildings" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_buildings_canonical_name" CHECK (length(btrim(canonical_name)) > 0),
        CONSTRAINT "CHK_buildings_short_name" CHECK (length(btrim(short_name)) > 0),
        CONSTRAINT "CHK_buildings_latitude" CHECK (latitude BETWEEN -90 AND 90),
        CONSTRAINT "CHK_buildings_longitude" CHECK (longitude BETWEEN -180 AND 180)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "building_name_keys" (
        "key" text NOT NULL,
        "building_id" uuid NOT NULL,
        CONSTRAINT "PK_building_name_keys" PRIMARY KEY ("key"),
        CONSTRAINT "FK_building_name_keys_building" FOREIGN KEY ("building_id")
          REFERENCES "buildings"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_building_name_keys_building_id"
      ON "building_name_keys" ("building_id")
    `);

    await queryRunner.query(`
      CREATE TABLE "categories" (
        "id" uuid NOT NULL,
        "name" varchar(50) NOT NULL,
        "name_key" text NOT NULL,
        "retired_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_categories" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_categories_name" CHECK (length(btrim(name)) > 0)
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_categories_name_key_active"
      ON "categories" ("name_key") WHERE (retired_at IS NULL)
    `);

    await queryRunner.query(`
      CREATE TABLE "suppliers" (
        "id" uuid NOT NULL,
        "name" varchar(100) NOT NULL,
        "name_key" text NOT NULL,
        "kind" "supplier_kind" NOT NULL,
        "building_id" uuid NOT NULL,
        "floor" varchar(2) NOT NULL,
        "location_description" varchar(255) NOT NULL,
        "latitude" double precision NOT NULL,
        "longitude" double precision NOT NULL,
        "photo_url" varchar(2048),
        "status" "supplier_status" NOT NULL DEFAULT 'Active',
        "version" integer NOT NULL DEFAULT 1,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_suppliers" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_suppliers_name_key_building_floor"
          UNIQUE ("name_key", "building_id", "floor"),
        CONSTRAINT "CHK_suppliers_name" CHECK (length(btrim(name)) BETWEEN 1 AND 100),
        CONSTRAINT "CHK_suppliers_floor" CHECK (floor ~ '^(B[1-9]|[1-9][0-9]?|M)$'),
        CONSTRAINT "CHK_suppliers_location_description" CHECK (length(btrim(location_description)) > 0),
        CONSTRAINT "CHK_suppliers_latitude" CHECK (latitude BETWEEN -90 AND 90),
        CONSTRAINT "CHK_suppliers_longitude" CHECK (longitude BETWEEN -180 AND 180),
        CONSTRAINT "FK_suppliers_building" FOREIGN KEY ("building_id")
          REFERENCES "buildings"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_suppliers_building_id" ON "suppliers" ("building_id")
    `);

    await queryRunner.query(`
      CREATE TABLE "supplier_categories" (
        "supplier_id" uuid NOT NULL,
        "category_id" uuid NOT NULL,
        CONSTRAINT "PK_supplier_categories" PRIMARY KEY ("supplier_id", "category_id"),
        CONSTRAINT "FK_supplier_categories_supplier" FOREIGN KEY ("supplier_id")
          REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_supplier_categories_category" FOREIGN KEY ("category_id")
          REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_supplier_categories_category_id"
      ON "supplier_categories" ("category_id")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "supplier_categories"`);
    await queryRunner.query(`DROP TABLE "suppliers"`);
    await queryRunner.query(`DROP TABLE "categories"`);
    await queryRunner.query(`DROP TABLE "building_name_keys"`);
    await queryRunner.query(`DROP TABLE "buildings"`);
    await queryRunner.query(`DROP TYPE "supplier_status"`);
    await queryRunner.query(`DROP TYPE "supplier_kind"`);
  }
}
