import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * A single field change recorded by an admin-initiated user update
 * `changedFields` maps each changed field name to its before/after
 * values, e.g. `{ "isAdmin": { "from": false, "to": true } }`.
 */
export interface UserUpdateAuditChangedField {
  from: unknown;
  to: unknown;
}

/**
 * Append-only audit record of an admin-initiated user update or insert.
 * Written in the same transaction as the change it describes, so an entry
 * exists if and only if the corresponding change committed. Inserts are
 * recorded as a set of from-null changes (`{ "email": { "from": null, "to":
 * "..." } }`). No service code ever updates or deletes rows in this table.
 */
@Entity('user_update_audit')
export class UserUpdateAudit {
  @PrimaryColumn({ type: 'uuid', default: () => 'gen_random_uuid()' })
  id: string;

  /** The acting admin's account uuid. */
  @Column({ type: 'uuid' })
  actorUuid: string;

  /** The target account's uuid whose fields were changed */
  @Column({ type: 'uuid' })
  targetUuid: string;

  /** Field-name keyed map of `{ from, to }` values */
  @Column({ type: 'jsonb' })
  changedFields: Record<string, UserUpdateAuditChangedField>;

  @CreateDateColumn()
  createdAt: Date;
}
