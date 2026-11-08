import { Check, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** The kinds of record the audit log covers (F14.4). */
export const AUDIT_TARGET_TYPES = [
  'supplier',
  'request',
  'category',
  'brand',
  'building',
] as const;
export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[number];

/**
 * One committed change to a supplier, request, category, brand or building
 * (F14.4): who made it, what it was, which record, the record's values before
 * and after, the resulting version where there is one, and when. It is written
 * in the same transaction as the change, so an entry exists if and only if the
 * change committed. Entries are append-only (F14.5): database triggers refuse
 * UPDATE, DELETE and TRUNCATE. There is deliberately no foreign key to the
 * audited record, so entries are kept after it is hard-deleted (F14.5).
 */
@Entity({ name: 'audit_entries' })
@Check(
  'CHK_audit_entries_target_type',
  `target_type IN ('supplier', 'request', 'category', 'brand', 'building')`,
)
@Check('CHK_audit_entries_action', `length(btrim(action)) > 0`)
@Index('IDX_audit_entries_target', ['targetType', 'targetId', 'id'])
@Index('IDX_audit_entries_actor', ['actorId', 'id'])
export class AuditEntry {
  /** An identity number, so the order of entries is exact. */
  @PrimaryGeneratedColumn('identity', {
    type: 'bigint',
    generatedIdentity: 'ALWAYS',
    primaryKeyConstraintName: 'PK_audit_entries',
  })
  id: string;

  @Column({
    name: 'occurred_at',
    type: 'timestamptz',
    default: () => 'now()',
  })
  occurredAt: Date;

  /** The acting user's id from the token; null for the system (the seed). */
  @Column({ name: 'actor_id', type: 'uuid', nullable: true })
  actorId: string | null;

  /** e.g. "supplier.updated". */
  @Column({ type: 'varchar', length: 64 })
  action: string;

  @Column({ name: 'target_type', type: 'varchar', length: 16 })
  targetType: AuditTargetType;

  @Column({ name: 'target_id', type: 'uuid' })
  targetId: string;

  /** The record before the change; null for a creation. */
  @Column({ type: 'jsonb', nullable: true })
  before: Record<string, unknown> | null;

  /** The record after the change. */
  @Column({ type: 'jsonb', nullable: true })
  after: Record<string, unknown> | null;

  /** The supplier's version after the change, where applicable. */
  @Column({ type: 'integer', nullable: true })
  version: number | null;
}
