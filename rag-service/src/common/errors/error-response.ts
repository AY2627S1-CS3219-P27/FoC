/**
 * Machine-readable error codes. Clients branch on `code`, never on `message`.
 */
export const ErrorCode = {
  BadRequest: 'BAD_REQUEST',
  ValidationFailed: 'VALIDATION_FAILED',
  Unauthenticated: 'UNAUTHENTICATED',
  Forbidden: 'FORBIDDEN',
  NotFound: 'NOT_FOUND',
  Conflict: 'CONFLICT',
  PayloadTooLarge: 'PAYLOAD_TOO_LARGE',
  /** The user asked too many questions in the current window. */
  RateLimited: 'RATE_LIMITED',
  DependencyUnavailable: 'DEPENDENCY_UNAVAILABLE',
  InternalError: 'INTERNAL_ERROR',
} as const;

/** One non-compliant field and why it failed. */
export interface FieldViolation {
  /** Dot path of the offending field, e.g. `question`. */
  field: string;
  reason: string;
}

/**
 * The single error body every RAG Service endpoint returns, the same shape as
 * Supplier Service's. It keeps Nest's default fields (statusCode, error,
 * message) and adds `code`, plus `violations` for validation errors and
 * `retryable` for transient failures.
 */
export interface ErrorResponseBody {
  statusCode: number;
  error: string;
  message: string;
  code: string;
  violations?: FieldViolation[];
  retryable?: boolean;
}
