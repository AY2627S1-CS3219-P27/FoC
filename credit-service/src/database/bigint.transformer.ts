import type { ValueTransformer } from 'typeorm';

/**
 * Guards the boundary between PostgreSQL BIGINT values and JavaScript numbers.
 * PostgreSQL can represent integers that JavaScript cannot represent exactly,
 * so silently converting an unsafe value would corrupt a credit balance.
 */
function assertSafeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${field} must be a JavaScript-safe integer`);
  }

  return value;
}

/**
 * Returns a transformer that converts between JavaScript numbers and PostgreSQL BIGINT values.
 */
export const bigintTransformer: ValueTransformer = {
  to(value: number | null | undefined): string | null | undefined {
    if (value === null || value === undefined) {
      return value;
    }

    return assertSafeInteger(value, 'BIGINT value').toString();
  },
  from(value: string | null): number | null {
    if (value === null) {
      return null;
    }

    return assertSafeInteger(Number(value), 'Database BIGINT value');
  },
};
