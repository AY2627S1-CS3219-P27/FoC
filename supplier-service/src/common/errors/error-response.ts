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
  /** Same normalised name, building and floor as another supplier (F1.5.1). */
  DuplicateSupplier: 'DUPLICATE_SUPPLIER',
  /** A category or building name already used by a non-retired one. */
  DuplicateName: 'DUPLICATE_NAME',
  /** No supplier has this id (never existed or hard-deleted, F5.9.1). */
  SupplierNotFound: 'SUPPLIER_NOT_FOUND',
  /** The If-Match version is not the supplier's current one (F14.3.1). */
  VersionConflict: 'VERSION_CONFLICT',
  /** Only Active <-> Inactive is allowed (F9.2). */
  InvalidStatusTransition: 'INVALID_STATUS_TRANSITION',
  /** No supplier request has this id. */
  RequestNotFound: 'REQUEST_NOT_FOUND',
  /** The request is no longer Pending (F6.3). */
  RequestAlreadyResolved: 'REQUEST_ALREADY_RESOLVED',
  /** An identical request is already Pending (F7.2). */
  DuplicateRequest: 'DUPLICATE_REQUEST',
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
 * `violations` for validation errors, `retryable` for transient failures and
 * `currentVersion` for a version conflict (F14.3.1).
 */
export interface ErrorResponseBody {
  statusCode: number;
  error: string;
  message: string;
  code: string;
  violations?: FieldViolation[];
  retryable?: boolean;
  currentVersion?: number;
}
