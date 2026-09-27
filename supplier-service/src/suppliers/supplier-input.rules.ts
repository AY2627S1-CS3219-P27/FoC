import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { FieldViolation } from '../common/errors/error-response.js';
import { toFieldViolations } from '../common/errors/validation-exception.factory.js';
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
export async function checkSupplierInput(
  input: unknown,
  campus: CampusBox,
): Promise<SupplierInputCheck> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return {
      valid: false,
      violations: [{ field: '', reason: 'supplier must be a JSON object' }],
    };
  }

  const dto = plainToInstance(SupplierInputDto, input);
  const violations = toFieldViolations(
    await validate(dto, { whitelist: true, forbidNonWhitelisted: true }),
  );
  violations.push(...campusViolations(dto, campus, violations));

  return violations.length === 0
    ? { valid: true, value: dto }
    : { valid: false, violations };
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
  const found: FieldViolation[] = [];

  if (
    !alreadyInvalid('coordinates.latitude') &&
    (dto.coordinates.latitude < campus.minLatitude ||
      dto.coordinates.latitude > campus.maxLatitude)
  ) {
    found.push({
      field: 'coordinates.latitude',
      reason: `latitude must lie within the campus (${campus.minLatitude} to ${campus.maxLatitude})`,
    });
  }
  if (
    !alreadyInvalid('coordinates.longitude') &&
    (dto.coordinates.longitude < campus.minLongitude ||
      dto.coordinates.longitude > campus.maxLongitude)
  ) {
    found.push({
      field: 'coordinates.longitude',
      reason: `longitude must lie within the campus (${campus.minLongitude} to ${campus.maxLongitude})`,
    });
  }
  return found;
}
