// Add on | 'INVALID_ENVELOPE' | '...', etc. as contracts grow
export type ContractFailureCode = 'INVALID_TOKEN_PAYLOAD';

/**
 * Standardized violation format that validation
 * callers receive.
 */
export interface ContractViolation {
  instancePath: string;
  /** Path to a JSON schema. May be '' for schema-less contracts. **/
  schemaPath: string;
  keyword: string;
  message: string;
}

export type ContractValidationResult<T> =
  | { valid: true; value: T }
  | {
      valid: false;
      code: ContractFailureCode;
      violations: ContractViolation[];
    };
