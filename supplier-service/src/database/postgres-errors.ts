/** PostgreSQL SQLSTATE for a unique-constraint violation. */
const UNIQUE_VIOLATION = '23505';

interface PostgresDriverError {
  code?: unknown;
  constraint?: unknown;
}

function driverError(error: unknown): PostgresDriverError | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  // TypeORM wraps node-postgres errors in QueryFailedError.driverError.
  const { driverError: wrapped } = error as { driverError?: unknown };
  return (
    typeof wrapped === 'object' && wrapped !== null ? wrapped : error
  ) as PostgresDriverError;
}

/**
 * True when the error is PostgreSQL rejecting a duplicate under the named
 * unique constraint or index. Used to turn a race the database caught into
 * the matching 409, instead of a 500.
 */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  const details = driverError(error);
  return (
    details?.code === UNIQUE_VIOLATION && details.constraint === constraint
  );
}
