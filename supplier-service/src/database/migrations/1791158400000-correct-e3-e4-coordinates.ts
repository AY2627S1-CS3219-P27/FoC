import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The first seed placed E3 about 2 km west of its own rooms and E4 about
 * 360 m off, because it averaged the supplier positions. Moves both to the
 * median of their rooms, as in data/json/venues-seed.json. Only a building
 * still at the old seeded coordinates moves, so a position an admin has since
 * set is left alone; a database without them is a no-op. Reversible the same
 * way.
 */
const MOVES = [
  {
    shortName: 'E3',
    old: [1.299434, 103.75263],
    corrected: [1.299484, 103.771747],
  },
  {
    shortName: 'E4',
    old: [1.299152, 103.769064],
    corrected: [1.298447, 103.772265],
  },
] as const;

export class CorrectE3E4Coordinates1791158400000 implements MigrationInterface {
  name = 'CorrectE3E4Coordinates1791158400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const { shortName, old, corrected } of MOVES) {
      await move(queryRunner, shortName, old, corrected);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const { shortName, old, corrected } of MOVES) {
      await move(queryRunner, shortName, corrected, old);
    }
  }
}

async function move(
  queryRunner: QueryRunner,
  shortName: string,
  from: readonly [number, number],
  to: readonly [number, number],
): Promise<void> {
  await queryRunner.query(
    `UPDATE "buildings"
        SET "latitude" = $1, "longitude" = $2, "updated_at" = now()
      WHERE "short_name" = $3 AND "latitude" = $4 AND "longitude" = $5`,
    [to[0], to[1], shortName, from[0], from[1]],
  );
}
