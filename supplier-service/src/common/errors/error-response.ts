/**
 * Machine-readable error codes. Clients branch on `code`, never on `message`.
 * Feature modules add their own (e.g. DUPLICATE_SUPPLIER) when they need one.
 */
export const ErrorCode = {
  BadRequest: 'BAD_REQUEST',
  ValidationFailed: 'VALIDATION_FAILED',
  Unauthenticated: 'UNAUTHENTICATED',
  Forbidden: 'FORBIDDEN',
  NotFound: 'NOT_FOUND',
  Conflict: 'CONFLICT',
  PayloadTooLarge: 'PAYLOAD_TOO_LARGE',
  PreconditionRequired: 'PRECONDITION_REQUIRED',
  DependencyUnavailable: 'DEPENDENCY_UNAVAILABLE',
  InternalError: 'INTERNAL_ERROR',
} as const;

/** One non-compliant field and why it failed (N8.4.1.1). */
export interface FieldViolation {
  /** Dot path of the offending field, e.g. `coordinates.latitude`. */
  field: string;
  reason: string;
}

/**
 * The single error body every Supplier Service endpoint returns. It keeps
 * Nest's default fields (statusCode, error, message) and adds `code`, plus
 * `violations` for validation errors and `retryable` for transient failures.
 */
export interface ErrorResponseBody {
  statusCode: number;
  error: string;
  message: string;
  code: string;
  violations?: FieldViolation[];
  retryable?: boolean;
}
