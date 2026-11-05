import { nameKey } from '../common/normalise/normalise.js';
import { SupplierKind } from '../database/entities/index.js';

/** Seed suppliers that are not Stores, by seed Name (F12.2.5). */
const KIND_OVERRIDES = new Map<string, SupplierKind>([
  [nameKey('Printer @ Com 2'), SupplierKind.Facility],
]);

/**
 * Seed suppliers renamed so outlets inside a food court stay distinct from
 * other outlets of the same business in that building, by seed Name.
 */
const NAME_OVERRIDES = new Map<string, string>([
  [nameKey('InstaChef'), 'InstaChef (Terrace)'],
  [nameKey('Smooy'), 'Smooy (Terrace)'],
]);

/** The kind for a seed row, defaulting to Store (F12.2.5). */
export function seedKind(seedName: string): SupplierKind {
  return KIND_OVERRIDES.get(nameKey(seedName)) ?? SupplierKind.Store;
}

/** The configured replacement name for a seed row, if any. */
export function seedNameOverride(seedName: string): string | undefined {
  return NAME_OVERRIDES.get(nameKey(seedName));
}
