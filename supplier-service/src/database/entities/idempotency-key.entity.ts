import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

/**
 * A client-supplied idempotency key for a request that creates a record
 * (F14.2). One row per user and key. The fingerprint identifies the request,
 * so a repeat with a different payload is refused (F14.2.2). While the
 * request runs the row has no `completed_at`; once it succeeded, the status,
 * headers and body of the answer are stored and replayed for a repeat within
 * 24 hours (F14.2.1). `claim_id` ties completing or releasing to the attempt
 * that made the claim, so an attempt whose stale claim was taken over cannot
 * overwrite the new one.
 */
@Entity({ name: 'idempotency_keys' })
@Check('CHK_idempotency_keys_key', `length(key) BETWEEN 1 AND 255`)
@Check(
  'CHK_idempotency_keys_completed',
  `(completed_at IS NULL) = (status_code IS NULL)`,
)
@Index('IDX_idempotency_keys_created_at', ['createdAt'])
export class IdempotencyKey {
  /** The authenticated user, from the token (F16.1 style: never the body). */
  @PrimaryColumn({
    name: 'user_id',
    type: 'uuid',
    primaryKeyConstraintName: 'PK_idempotency_keys',
  })
  userId: string;

  @PrimaryColumn({
    type: 'varchar',
    length: 255,
    primaryKeyConstraintName: 'PK_idempotency_keys',
  })
  key: string;

  @Column({ name: 'claim_id', type: 'uuid' })
  claimId: string;

  /** SHA-256 hex of the request: method, path, body, If-Match. */
  @Column({ type: 'varchar', length: 64 })
  fingerprint: string;

  @Column({ name: 'status_code', type: 'smallint', nullable: true })
  statusCode: number | null;

  @Column({ type: 'jsonb', nullable: true })
  headers: Record<string, string> | null;

  @Column({ type: 'jsonb', nullable: true })
  body: unknown;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  /** Null while the request is still running. */
  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;
}
