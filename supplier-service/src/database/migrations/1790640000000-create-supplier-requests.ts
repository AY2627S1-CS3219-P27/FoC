import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates supplier_requests: basic users' requests to create, update or
 * change the status of a supplier, moderated by an admin (F6, F7).
 */
export class CreateSupplierRequests1790640000000 implements MigrationInterface {
  name = 'CreateSupplierRequests1790640000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "supplier_request_type" AS ENUM ('Create', 'Update', 'StatusChange')
    `);
    await queryRunner.query(`
      CREATE TYPE "supplier_request_state" AS ENUM ('Pending', 'Approved', 'Denied', 'Withdrawn')
    `);

    await queryRunner.query(`
      CREATE TABLE "supplier_requests" (
        "id" uuid NOT NULL,
        "type" "supplier_request_type" NOT NULL,
        "state" "supplier_request_state" NOT NULL DEFAULT 'Pending',
        "supplier_id" uuid,
        "supplier_version" integer,
        "payload" jsonb NOT NULL,
        "name_key" text,
        "building_id" uuid,
        "floor" varchar(2),
        "submitted_by" text NOT NULL,
        "submitted_at" timestamptz NOT NULL DEFAULT now(),
        "resolved_by" text,
        "resolved_at" timestamptz,
        "denial_reason" varchar(500),
        "created_supplier_id" uuid,
        CONSTRAINT "PK_supplier_requests" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_supplier_requests_target" CHECK (
          (type = 'Create' AND supplier_id IS NULL AND supplier_version IS NULL
            AND name_key IS NOT NULL AND building_id IS NOT NULL AND floor IS NOT NULL)
          OR (type <> 'Create' AND supplier_id IS NOT NULL AND supplier_version IS NOT NULL
            AND name_key IS NULL AND building_id IS NULL AND floor IS NULL)
        ),
        CONSTRAINT "CHK_supplier_requests_resolution" CHECK (
          (state = 'Pending' AND resolved_by IS NULL AND resolved_at IS NULL)
          OR (state <> 'Pending' AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL)
        ),
        CONSTRAINT "CHK_supplier_requests_denial_reason" CHECK (
          (state = 'Denied') = (denial_reason IS NOT NULL)
          AND (denial_reason IS NULL OR length(btrim(denial_reason)) > 0)
        ),
        CONSTRAINT "CHK_supplier_requests_created_supplier" CHECK (
          created_supplier_id IS NULL OR (type = 'Create' AND state = 'Approved')
        ),
        CONSTRAINT "FK_supplier_requests_supplier" FOREIGN KEY ("supplier_id")
          REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "FK_supplier_requests_building" FOREIGN KEY ("building_id")
          REFERENCES "buildings"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "FK_supplier_requests_created_supplier" FOREIGN KEY ("created_supplier_id")
          REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE NO ACTION
      )
    `);

    // Only one Pending creation request per duplicate key (F7.2).
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_supplier_requests_pending_create"
      ON "supplier_requests" ("name_key", "building_id", "floor")
      WHERE type = 'Create' AND state = 'Pending'
    `);
    // The admin queue: Pending requests by type, oldest first (F6.7).
    await queryRunner.query(`
      CREATE INDEX "IDX_supplier_requests_pending_queue"
      ON "supplier_requests" ("type", "submitted_at")
      WHERE state = 'Pending'
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_supplier_requests_submitted_by"
      ON "supplier_requests" ("submitted_by")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "supplier_requests"`);
    await queryRunner.query(`DROP TYPE "supplier_request_state"`);
    await queryRunner.query(`DROP TYPE "supplier_request_type"`);
  }
}
