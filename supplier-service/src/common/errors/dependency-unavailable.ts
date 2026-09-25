/**
 * Network-level failures reaching PostgreSQL, as raised by node-postgres.
 */
const UNAVAILABLE_NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
]);

/**
 * PostgreSQL SQLSTATEs meaning "the database cannot serve you right now":
 * class 08 (connection exception), 53 (insufficient resources) and 57P01-03
 * (server shutting down or not yet accepting connections).
 */
function isUnavailableSqlState(code: string): boolean {
  return (
    code.startsWith('08') ||
    code.startsWith('53') ||
    ['57P01', '57P02', '57P03'].includes(code)
  );
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const { code } = error as { code?: unknown };
  return typeof code === 'string' ? code : undefined;
}

/**
 * True when a failure means the data store is unreachable, as opposed to the
 * request itself being wrong. Such failures must surface as a retryable 503,
 * never as not-found (F15.3) or a validation error (F14.1.1).
 *
 * TypeORM wraps driver errors (QueryFailedError.driverError), so both the
 * error and its wrapped cause are inspected.
 */
export function isDependencyUnavailableError(error: unknown): boolean {
  const candidates = [
    error,
    (error as { driverError?: unknown } | null)?.driverError,
    (error as { cause?: unknown } | null)?.cause,
  ];

  if (
    error instanceof Error &&
    /Connection terminated|timeout exceeded when trying to connect/i.test(
      error.message,
    )
  ) {
    return true;
  }

  return candidates.some((candidate) => {
    const code = errorCode(candidate);
    return (
      code !== undefined &&
      (UNAVAILABLE_NETWORK_CODES.has(code) || isUnavailableSqlState(code))
    );
  });
}
