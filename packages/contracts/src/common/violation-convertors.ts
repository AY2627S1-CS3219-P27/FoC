import { ValidationError } from 'joi';
import { ContractViolation } from './types.js';

/**
 * Maps Joi error details onto uniform contract violations. Only `path`, `type`, and
 * `message` are read - offending values are not returned so as to not leak potentially
 * sensitive (or attacker-controlled) values.
 */
export function joiErrorsToViolations(
  error: ValidationError,
): ContractViolation[] {
  return error.details.map(({ path, type, message }) => ({
    instancePath: path.length === 0 ? '' : `/${path.join('/')}`,
    schemaPath: '',
    keyword: type,
    message,
  }));
}

// Expect another function here to convert ajv schema violations to contractviolation
