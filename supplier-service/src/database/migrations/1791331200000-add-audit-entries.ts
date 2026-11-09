import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The audit log (F14.4, F14.5): one append-only row per committed change to a
 * supplier, request, category, brand or building. No foreign keys, so entries
 * outlive the records they describe. Triggers refuse UPDATE, DELETE and
 * TRUNCATE, so not even a bug in the service can alter the log.
 */
export class AddAuditEntries1791331200000 implements MigrationInterface {
  name = 'AddAuditEntries1791331200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "audit_entries" (
        "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
        "occurred_at" timestamptz NOT NULL DEFAULT now(),
        "actor_id" uuid,
        "action" varchar(64) NOT NULL,
        "target_type" varchar(16) NOT NULL,
        "target_id" uuid NOT NULL,
        "before" jsonb,
        "after" jsonb,
        "version" integer,
        CONSTRAINT "PK_audit_entries" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_audit_entries_target_type" CHECK (target_type IN ('supplier', 'request', 'category', 'brand', 'building')),
        CONSTRAINT "CHK_audit_entries_action" CHECK (length(btrim(action)) > 0)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_audit_entries_target"
      ON "audit_entries" ("target_type", "target_id", "id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_audit_entries_actor"
      ON "audit_entries" ("actor_id", "id")
    `);
    // Append-only (F14.5).
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION audit_entries_append_only() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'audit_entries is append-only: % is not allowed', TG_OP
          USING ERRCODE = 'integrity_constraint_violation';
      END;
      $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TRG_audit_entries_no_update_delete"
      BEFORE UPDATE OR DELETE ON "audit_entries"
      FOR EACH ROW EXECUTE FUNCTION audit_entries_append_only()
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TRG_audit_entries_no_truncate"
      BEFORE TRUNCATE ON "audit_entries"
      FOR EACH STATEMENT EXECUTE FUNCTION audit_entries_append_only()
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "audit_entries"`);
    await queryRunner.query(`DROP FUNCTION audit_entries_append_only()`);
  }
}
