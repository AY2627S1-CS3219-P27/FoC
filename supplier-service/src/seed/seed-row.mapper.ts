import { nameKey } from '../common/normalise/normalise.js';
import { seedKind, seedNameOverride } from './reference-data.js';

/** The seed file's column headers. */
export const SEED_COLUMNS = {
  name: 'Name',
  type: 'Type',
  building: 'Building',
  floor: 'Floor',
  locationDescription: 'Location Description',
  latitude: 'Latitude',
  longitude: 'Longitude',
  imageUrl: 'ImageURL',
} as const;

/**
 * Splits a seed Type into category names: "Food/Coffee" becomes Food and
 * Coffee (F12.2.2). Blank parts and case-insensitive repeats are dropped.
 */
export function categoryNamesOf(type: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const part of type.split('/')) {
    const name = part.trim();
    if (name !== '' && !seen.has(nameKey(name))) {
      seen.add(nameKey(name));
      names.push(name);
    }
  }
  return names;
}

/**
 * Splits "Printer @ Com 2" into its base name and building suffix. The
 * caller strips the suffix only if it names the row's own building
 * (F12.2.6), since the display name (F1.4) re-derives it.
 */
export function splitBuildingSuffix(
  name: string,
): { base: string; suffix: string } | null {
  const at = name.lastIndexOf('@');
  if (at <= 0) {
    return null;
  }
  const base = name.slice(0, at).trim();
  const suffix = name.slice(at + 1).trim();
  return base !== '' && suffix !== '' ? { base, suffix } : null;
}

/** The name to store: the configured override, else the (stripped) name. */
export function seedSupplierName(
  seedName: string,
  strippedName: string,
): string {
  return seedNameOverride(seedName) ?? strippedName;
}

/**
 * Builds the raw supplier submission for one seed row. Values are passed
 * through as-is apart from type conversion, so the suppliers service
 * validates every seed record exactly as it validates the API (F12.3).
 */
export function toSupplierInput(
  values: Record<string, string>,
  resolved: { name: string; buildingId: string | null; categoryIds: string[] },
): Record<string, unknown> {
  const imageUrl = values[SEED_COLUMNS.imageUrl] ?? '';
  return {
    name: resolved.name,
    kind: seedKind(values[SEED_COLUMNS.name] ?? ''),
    categoryIds: resolved.categoryIds,
    buildingId: resolved.buildingId,
    floor: values[SEED_COLUMNS.floor],
    locationDescription: values[SEED_COLUMNS.locationDescription],
    coordinates: {
      latitude: toNumber(values[SEED_COLUMNS.latitude]),
      longitude: toNumber(values[SEED_COLUMNS.longitude]),
    },
    // Photo where present, otherwise none (F12.2.4).
    ...(imageUrl !== '' && { photoUrl: imageUrl }),
  };
}

/** A numeric cell as a number; anything else stays text so validation names it. */
function toNumber(cell: string | undefined): unknown {
  if (cell === undefined || cell.trim() === '') {
    return cell;
  }
  const value = Number(cell);
  return Number.isFinite(value) ? value : cell;
}
