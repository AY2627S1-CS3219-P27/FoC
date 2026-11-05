import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the delivery venues table: rooms inside buildings. Every rule the
 * database can express is a named constraint, so a rejected write names the
 * rule it broke. Venues are retired, never deleted.
 */
export class CreateVenues1791072000000 implements MigrationInterface {
  name = 'CreateVenues1791072000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "venues" (
        "id" uuid NOT NULL,
        "building_id" uuid NOT NULL,
        "code" varchar(30) NOT NULL,
        "name" varchar(100),
        "floor" varchar(2) NOT NULL,
        "latitude" double precision NOT NULL,
        "longitude" double precision NOT NULL,
        "retired_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_venues" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_venues_building_code" UNIQUE ("building_id", "code"),
        CONSTRAINT "CHK_venues_code" CHECK (length(btrim(code)) > 0),
        CONSTRAINT "CHK_venues_name" CHECK (name IS NULL OR length(btrim(name)) > 0),
        CONSTRAINT "CHK_venues_floor" CHECK (floor ~ '^(B[1-9]|[1-9][0-9]?|M)$'),
        CONSTRAINT "CHK_venues_latitude" CHECK (latitude BETWEEN -90 AND 90),
        CONSTRAINT "CHK_venues_longitude" CHECK (longitude BETWEEN -180 AND 180),
        CONSTRAINT "FK_venues_building" FOREIGN KEY ("building_id")
          REFERENCES "buildings"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_venues_building_id" ON "venues" ("building_id")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "venues"`);
  }
}
