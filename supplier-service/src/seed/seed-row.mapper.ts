import type { FieldViolation } from '../common/errors/error-response.js';
import { nameKey } from '../common/normalise/normalise.js';
import {
  DAYS,
  formatTime,
  type OpeningHours,
  parseTime,
} from '../opening-hours/opening-hours.js';
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
  startingTime: 'StartingTime',
  closingTime: 'ClosingTime',
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

/** "0900hrs" as minutes since midnight, or null if it is not that format. */
function seedMinutes(cell: string | undefined): number | null {
  const match = /^(\d{2})(\d{2})hrs$/i.exec((cell ?? '').trim());
  return match === null ? null : parseTime(`${match[1]}:${match[2]}`);
}

const isBlank = (cell: string | undefined) => (cell ?? '').trim() === '';

/**
 * The opening hours of a seed row: StartingTime and ClosingTime are the same
 * interval on all seven days, and "0000hrs" to "2359hrs" means open 24 hours
 * (F12.2.3, F2.2). Null when both cells are blank (no fixed hours, F1.2.8) or
 * when they cannot be read, which seedHoursViolations reports.
 */
export function seedOpeningHours(
  values: Record<string, string>,
): OpeningHours | null {
  const opens = seedMinutes(values[SEED_COLUMNS.startingTime]);
  const closes = seedMinutes(values[SEED_COLUMNS.closingTime]);
  if (opens === null || closes === null || opens === closes) {
    return null;
  }
  if (opens === 0 && closes === 23 * 60 + 59) {
    return { open24Hours: true };
  }
  const interval = { opens: formatTime(opens), closes: formatTime(closes) };
  return { days: Object.fromEntries(DAYS.map((day) => [day, [interval]])) };
}

/**
 * What is wrong with a row's times, named by their seed columns so the
 * startup log points at the cell (F12.4): one cell without the other, a cell
 * that is not like "0900hrs", or equal times.
 */
export function seedHoursViolations(
  values: Record<string, string>,
): FieldViolation[] {
  const start = values[SEED_COLUMNS.startingTime];
  const close = values[SEED_COLUMNS.closingTime];
  if (isBlank(start) && isBlank(close)) {
    return [];
  }
  const violations: FieldViolation[] = [];
  for (const [column, cell] of [
    [SEED_COLUMNS.startingTime, start],
    [SEED_COLUMNS.closingTime, close],
  ] as const) {
    if (isBlank(cell)) {
      violations.push({
        field: column,
        reason: 'both StartingTime and ClosingTime are needed',
      });
    } else if (seedMinutes(cell) === null) {
      violations.push({
        field: column,
        reason: `"${cell}" is not a time like 0900hrs`,
      });
    }
  }
  if (violations.length === 0 && seedMinutes(start) === seedMinutes(close)) {
    violations.push({
      field: SEED_COLUMNS.closingTime,
      reason: 'ClosingTime must differ from StartingTime',
    });
  }
  return violations;
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
  const openingHours = seedOpeningHours(values);
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
    // Hours where readable (F12.2.3); unreadable cells are reported apart.
    ...(openingHours !== null && { openingHours }),
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
