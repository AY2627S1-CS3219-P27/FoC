import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Switches on pgvector, which adds the column type that stores embeddings and
 * the distance operators that compare them. The database image
 * (pgvector/pgvector) ships the extension; this makes it available in our
 * database.
 */
export class EnablePgvector1793923200000 implements MigrationInterface {
  name = 'EnablePgvector1793923200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS vector`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP EXTENSION IF EXISTS vector`);
  }
}
