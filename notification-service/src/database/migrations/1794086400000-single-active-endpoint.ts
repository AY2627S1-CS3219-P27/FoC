import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Enforces single ownership of a Web Push endpoint.
 *
 * A `PushSubscription` belongs to the browser profile, not the account, so at
 * most one *active* row may reference an endpoint. The previous
 * `UQ_subscriptions_user_id_endpoint` index only prevented one account from
 * registering the same endpoint twice; two accounts could still both be active
 * on one browser, which delivered each account's pushes to whoever was using
 * the device.
 *
 * Inactive rows are registration history and may share an endpoint, hence the
 * partial predicate. If an existing development database already holds two
 * active rows for one endpoint, remove the stale row before starting the
 * service: the index intentionally fails instead of guessing an owner.
 */
export class SingleActiveEndpoint1794086400000 implements MigrationInterface {
  name = 'SingleActiveEndpoint1794086400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_subscriptions_active_endpoint"
      ON "subscriptions" ("endpoint")
      WHERE "status" = 'active'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "UQ_subscriptions_active_endpoint"',
    );
  }
}
