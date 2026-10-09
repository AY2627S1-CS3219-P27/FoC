/**
 * Pure normalisation rules shared by validation, the services and the seed
 * import, so every path compares names and floors the same way.
 */

/** B1-B9 (basement), 1-99, or M (mezzanine), per F1.2.5. */
export const FLOOR_PATTERN = /^(B[1-9]|[1-9][0-9]?|M)$/;

/**
 * The duplicate-detection key for supplier and category names (F1.5,
 * F11.2.1): Unicode NFC, trimmed, internal whitespace collapsed to one space,
 * and case-folded.
 */
export function nameKey(value: string): string {
  return value
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .normalize('NFC');
}

/** Curly, backtick and other apostrophe-like characters. */
const APOSTROPHES = /[‘’‛ʼ`´′]/g;

/**
 * The lookup key for building names, short names and aliases (F4.2, F4.5):
 * case-insensitive, ignoring whitespace entirely, and treating every
 * apostrophe style as a plain "'", so "Com 2", "COM2" and "com2" are the same
 * building name, and so are "Prince George's Park" and "Prince George’s Park".
 */
export function buildingKey(value: string): string {
  return value
    .normalize('NFC')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(APOSTROPHES, "'")
    .normalize('NFC');
}

/** Floors are stored upper-cased and trimmed, so "b1" is stored as "B1". */
export function normaliseFloor(value: string): string {
  return value.trim().toUpperCase();
}

/** "<Name> @ <Building short name>", e.g. "Cool Spot @ COM3" (F1.4). */
export function displayName(name: string, buildingShortName: string): string {
  return `${name} @ ${buildingShortName}`;
}
