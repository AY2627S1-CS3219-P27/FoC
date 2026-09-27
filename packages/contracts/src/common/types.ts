export type TokenContractFailureCode = 'INVALID_TOKEN_PAYLOAD';

export type EventContractFailureCode =
  'INVALID_ENVELOPE' | 'INVALID_PAYLOAD' | 'UNSUPPORTED_EVENT_TYPE';

export type ContractFailureCode =
  TokenContractFailureCode | EventContractFailureCode;

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

export type ContractValidationResult<
  T,
  TCode extends ContractFailureCode = ContractFailureCode,
> =
  | { valid: true; value: T }
  | {
      valid: false;
      code: TCode;
      violations: ContractViolation[];
    };
