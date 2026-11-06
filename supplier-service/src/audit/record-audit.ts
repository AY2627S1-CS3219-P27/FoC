import type { EntityManager } from 'typeorm';
import {
  AuditEntry,
  type AuditTargetType,
} from '../database/entities/index.js';
import { currentActor } from './audit-context.js';

export interface AuditRecord {
  /** e.g. "supplier.created". */
  action: string;
  targetType: AuditTargetType;
  targetId: string;
  /** The record before the change; omitted for a creation. */
  before?: Record<string, unknown> | null;
  /** The record after the change. */
  after?: Record<string, unknown> | null;
  /** The supplier's version after the change, where applicable. */
  version?: number | null;
}

/**
 * Writes an audit entry on the caller's transaction (F14.4), so the entry
 * commits, or rolls back, together with the change it describes. The actor is
 * the current request's user, or null for the system.
 */
export async function recordAudit(
  manager: EntityManager,
  entry: AuditRecord,
): Promise<void> {
  await manager.insert(AuditEntry, {
    actorId: currentActor(),
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    // TypeORM's insert typing cannot express a JSON column holding any object.
    before: (entry.before ?? null) as never,
    after: (entry.after ?? null) as never,
    version: entry.version ?? null,
  });
}
