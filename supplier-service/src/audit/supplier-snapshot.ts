import type { EntityManager } from 'typeorm';
import {
  Supplier,
  SupplierCategory,
  SupplierOpeningInterval,
} from '../database/entities/index.js';
import { type AuditSnapshot, supplierSnapshot } from './snapshots.js';

/**
 * Reads a supplier, its categories and its opening hours on the caller's
 * transaction, for the audit log's before and after (F14.4).
 */
export async function loadSupplierSnapshot(
  manager: EntityManager,
  id: string,
): Promise<AuditSnapshot> {
  const supplier = await manager.findOneByOrFail(Supplier, { id });
  const links = await manager.findBy(SupplierCategory, { supplierId: id });
  const intervals = await manager.findBy(SupplierOpeningInterval, {
    supplierId: id,
  });
  return supplierSnapshot(
    supplier,
    links.map((link) => link.categoryId),
    intervals.map(({ day, opensAt, closesAt }) => ({ day, opensAt, closesAt })),
  );
}
