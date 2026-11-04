import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { FieldViolation } from '../common/errors/error-response.js';
import { toFieldViolations } from '../common/errors/validation-exception.factory.js';
import { checkOpeningHours } from '../opening-hours/opening-hours.js';
import { SupplierInputDto } from './dto/supplier-input.dto.js';

/** The NUS campus bounding box from configuration (F1.2.7). */
export interface CampusBox {
  minLatitude: number;
  maxLatitude: number;
  minLongitude: number;
  maxLongitude: number;
}

export type SupplierInputCheck =
  | { valid: true; value: SupplierInputDto }
  | { valid: false; violations: FieldViolation[] };

/**
 * Checks a raw supplier submission against every rule that needs no database
 * access: the F1.2 field rules, unknown or system-managed fields (F1.6,
 * F1.3.2), and the campus bounding box. Every violation is collected, never
 * only the first (F1.6.1).
 */
export function checkSupplierInput(
  input: unknown,
  campus: CampusBox,
): Promise<SupplierInputCheck> {
  return check(input, campus, false);
}

/**
 * The same rules for an admin edit (F8.1): only the supplied fields are
 * checked, at least one must be supplied, and `photoUrl: null` removes the
 * photo. A field sent as null that is mandatory is still rejected.
 */
export function checkSupplierPatch(
  input: unknown,
  campus: CampusBox,
): Promise<SupplierInputCheck> {
  return check(input, campus, true);
}

async function check(
  input: unknown,
  campus: CampusBox,
  partial: boolean,
): Promise<SupplierInputCheck> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return {
      valid: false,
      violations: [{ field: '', reason: 'supplier must be a JSON object' }],
    };
  }
  if (partial && Object.keys(input).length === 0) {
    return {
      valid: false,
      violations: [
        { field: '', reason: 'at least one field must be supplied' },
      ],
    };
  }

  const dto = plainToInstance(SupplierInputDto, input);
  const supplied = new Set(Object.keys(input));
  const violations = toFieldViolations(
    await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
      // Absent fields are left as they are; null is still validated.
      skipUndefinedProperties: partial,
    }),
  ).filter(
    // IsDefined runs even for skipped fields; in an edit, only the supplied
    // fields can be wrong.
    (violation) => !partial || supplied.has(violation.field.split('.')[0]),
  );
  violations.push(...campusViolations(dto, campus, violations));
  violations.push(...openingHoursViolations(dto, violations));

  return violations.length === 0
    ? { valid: true, value: dto }
    : { valid: false, violations };
}

/**
 * Checks the opening hours (F2.1-F2.4) and replaces them with their canonical
 * form, so what is stored and approved later is deterministic. A value that
 * already failed its type rule is not judged again.
 */
function openingHoursViolations(
  dto: SupplierInputDto,
  existing: FieldViolation[],
): FieldViolation[] {
  if (
    dto.openingHours === undefined ||
    dto.openingHours === null ||
    existing.some((violation) => violation.field === 'openingHours')
  ) {
    return [];
  }
  const checked = checkOpeningHours(dto.openingHours);
  if (checked.valid) {
    dto.openingHours = checked.value;
    return [];
  }
  return checked.violations;
}

function campusViolations(
  dto: SupplierInputDto,
  campus: CampusBox,
  existing: FieldViolation[],
): FieldViolation[] {
  // Only judge coordinates that already passed their own number rules.
  const alreadyInvalid = (field: string) =>
    existing.some(
      (violation) =>
        violation.field === 'coordinates' || violation.field === field,
    );
  if (dto.coordinates === undefined) {
    return [];
  }
  return coordinatesOutsideCampus(dto.coordinates, campus).filter(
    (violation) => !alreadyInvalid(violation.field),
  );
}

/**
 * The coordinates that lie outside the campus bounding box (F1.2.7), one
 * violation per axis. Used for suppliers and for new buildings (F4.3).
 */
export function coordinatesOutsideCampus(
  coordinates: { latitude: number; longitude: number },
  campus: CampusBox,
): FieldViolation[] {
  const found: FieldViolation[] = [];
  if (
    coordinates.latitude < campus.minLatitude ||
    coordinates.latitude > campus.maxLatitude
  ) {
    found.push({
      field: 'coordinates.latitude',
      reason: `latitude must lie within the campus (${campus.minLatitude} to ${campus.maxLatitude})`,
    });
  }
  if (
    coordinates.longitude < campus.minLongitude ||
    coordinates.longitude > campus.maxLongitude
  ) {
    found.push({
      field: 'coordinates.longitude',
      reason: `longitude must lie within the campus (${campus.minLongitude} to ${campus.maxLongitude})`,
    });
  }
  return found;
}
