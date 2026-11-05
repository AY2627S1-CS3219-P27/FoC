import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The first seed named AS8 "Blk AS8", the supplier CSV's spelling. Renames it
 * to "Arts and Social Sciences 8" as in data/json/venues-seed.json and keeps
 * the old name as an alias, so lookups by "Blk AS8" still resolve. Only a
 * building still carrying the old name is touched; a database without it is a
 * no-op. Reversible the same way.
 */
const OLD_NAME = 'Blk AS8';
const NEW_NAME = 'Arts and Social Sciences 8';
const NEW_KEY = 'artsandsocialsciences8';

export class RenameAs8Building1791331200000 implements MigrationInterface {
  name = 'RenameAs8Building1791331200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const renamed = await rename(queryRunner, OLD_NAME, NEW_NAME);
    for (const { id } of renamed) {
      await queryRunner.query(
        `UPDATE "buildings"
            SET "aliases" = array_append("aliases", $2)
          WHERE "id" = $1 AND NOT ($2 = ANY("aliases"))`,
        [id, OLD_NAME],
      );
      await queryRunner.query(
        `INSERT INTO "building_name_keys" ("key", "building_id")
         VALUES ($1, $2)`,
        [NEW_KEY, id],
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const renamed = await rename(queryRunner, NEW_NAME, OLD_NAME);
    for (const { id } of renamed) {
      await queryRunner.query(
        `UPDATE "buildings" SET "aliases" = array_remove("aliases", $2)
          WHERE "id" = $1`,
        [id, OLD_NAME],
      );
      await queryRunner.query(
        `DELETE FROM "building_name_keys" WHERE "key" = $1 AND "building_id" = $2`,
        [NEW_KEY, id],
      );
    }
  }
}

async function rename(
  queryRunner: QueryRunner,
  from: string,
  to: string,
): Promise<{ id: string }[]> {
  const [rows] = await queryRunner.query(
    `UPDATE "buildings"
        SET "canonical_name" = $2, "updated_at" = now()
      WHERE "short_name" = 'AS8' AND "canonical_name" = $1
      RETURNING "id"`,
    [from, to],
  );
  return rows;
}
