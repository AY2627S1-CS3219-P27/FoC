import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUnreadMessageIndex1793638800000 implements MigrationInterface {
  name = 'AddUnreadMessageIndex1793638800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX "IDX_messages_chat_sender_unread_sequence"
      ON "messages" ("chat_id", "sender_id", "sequence")
      WHERE "read_at" IS NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX "IDX_messages_chat_sender_unread_sequence"
    `);
  }
}
