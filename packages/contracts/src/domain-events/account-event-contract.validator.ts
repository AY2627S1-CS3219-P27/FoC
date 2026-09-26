import {
  Ajv2020,
  type AnySchemaObject,
  type ErrorObject,
  type ValidateFunction,
} from 'ajv/dist/2020.js';
import * as addFormatsModule from 'ajv-formats';
import type { FormatsPlugin } from 'ajv-formats';
import type {
  ContractValidationResult,
  ContractViolation,
  EventContractFailureCode,
} from '../common/types.js';
import type {
  CreditAccountInitialisedEvent,
  EventEnvelope,
  UserRegisteredEvent,
} from './account-event-contract.types.js';
import creditAccountInitialisedSchemaJson from './schemas/credit-account-initialised.v1.schema.json' with { type: 'json' };
import eventEnvelopeSchemaJson from './schemas/event-envelope.v1.schema.json' with { type: 'json' };
import userRegisteredSchemaJson from './schemas/user-registered.v1.schema.json' with { type: 'json' };

const USER_REGISTERED = 'UserRegistered';
const CREDIT_ACCOUNT_INITIALISED = 'CreditAccountInitialised';

function sanitizeViolations(
  errors: ErrorObject[] | null | undefined,
): ContractViolation[] {
  return (errors ?? [])
    .map(({ instancePath, schemaPath, keyword, message }) => ({
      instancePath,
      schemaPath,
      keyword,
      message: message ?? 'validation failed',
    }))
    .sort((left, right) =>
      [left.instancePath, left.schemaPath, left.keyword, left.message]
        .join('\u0000')
        .localeCompare(
          [
            right.instancePath,
            right.schemaPath,
            right.keyword,
            right.message,
          ].join('\u0000'),
        ),
    );
}

function failure<T>(
  code: EventContractFailureCode,
  violations: ContractViolation[],
): ContractValidationResult<T, EventContractFailureCode> {
  return { valid: false, code, violations };
}

function unsupportedEvent<T>(
  expectedType: string,
): ContractValidationResult<T, EventContractFailureCode> {
  return failure('UNSUPPORTED_EVENT_TYPE', [
    {
      instancePath: '/eventType',
      schemaPath: '#/properties/eventType/const',
      keyword: 'const',
      message: `must be ${expectedType}; received event type is unsupported`,
    },
  ]);
}

function invalidPublisher<T>(
  expectedPublisher: string,
): ContractValidationResult<T, EventContractFailureCode> {
  return failure('INVALID_ENVELOPE', [
    {
      instancePath: '/publisher',
      schemaPath: '#/properties/publisher/const',
      keyword: 'const',
      message: `must be ${expectedPublisher}`,
    },
  ]);
}

/**
 * Validates decoded event values without coercing, defaulting, or removing
 * fields. Returned violations contain schema metadata but never event values.
 * The class has no framework dependencies and can be registered directly as a
 * provider by NestJS consumers.
 */
export class AccountEventContractValidator {
  private readonly envelopeValidator: ValidateFunction<EventEnvelope>;
  private readonly userRegisteredValidator: ValidateFunction<UserRegisteredEvent>;
  private readonly creditAccountInitialisedValidator: ValidateFunction<CreditAccountInitialisedEvent>;

  constructor() {
    const ajv = new Ajv2020({
      allErrors: true,
      strict: true,
      coerceTypes: false,
      useDefaults: false,
      removeAdditional: false,
    });
    const addFormats = addFormatsModule.default as unknown as FormatsPlugin;
    addFormats(ajv);

    const envelopeSchema = eventEnvelopeSchemaJson as AnySchemaObject;
    ajv.addSchema(envelopeSchema);
    this.envelopeValidator = ajv.getSchema<EventEnvelope>(
      envelopeSchema.$id as string,
    )!;
    this.userRegisteredValidator = ajv.compile<UserRegisteredEvent>(
      userRegisteredSchemaJson as AnySchemaObject,
    );
    this.creditAccountInitialisedValidator =
      ajv.compile<CreditAccountInitialisedEvent>(
        creditAccountInitialisedSchemaJson as AnySchemaObject,
      );
  }

  validateEnvelope(
    input: unknown,
  ): ContractValidationResult<EventEnvelope, EventContractFailureCode> {
    if (!this.envelopeValidator(input)) {
      return failure(
        'INVALID_ENVELOPE',
        sanitizeViolations(this.envelopeValidator.errors),
      );
    }

    return { valid: true, value: input };
  }

  validateUserRegistered(
    input: unknown,
  ): ContractValidationResult<UserRegisteredEvent, EventContractFailureCode> {
    const envelope = this.validateEnvelope(input);
    if (!envelope.valid) {
      return envelope;
    }
    if (envelope.value.eventType !== USER_REGISTERED) {
      return unsupportedEvent(USER_REGISTERED);
    }
    if (envelope.value.publisher !== 'user-service') {
      return invalidPublisher('user-service');
    }
    if (!this.userRegisteredValidator(input)) {
      return failure(
        'INVALID_PAYLOAD',
        sanitizeViolations(this.userRegisteredValidator.errors),
      );
    }

    return { valid: true, value: input };
  }

  validateCreditAccountInitialised(
    input: unknown,
  ): ContractValidationResult<
    CreditAccountInitialisedEvent,
    EventContractFailureCode
  > {
    const envelope = this.validateEnvelope(input);
    if (!envelope.valid) {
      return envelope;
    }
    if (envelope.value.eventType !== CREDIT_ACCOUNT_INITIALISED) {
      return unsupportedEvent(CREDIT_ACCOUNT_INITIALISED);
    }
    if (envelope.value.publisher !== 'credit-service') {
      return invalidPublisher('credit-service');
    }
    if (!this.creditAccountInitialisedValidator(input)) {
      return failure(
        'INVALID_PAYLOAD',
        sanitizeViolations(this.creditAccountInitialisedValidator.errors),
      );
    }

    return { valid: true, value: input };
  }
}
