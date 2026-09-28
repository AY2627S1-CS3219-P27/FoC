import {
  Ajv2020,
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
import type { EventContractDefinition } from './event-contract.types.js';
import eventEnvelopeSchema from './event-envelope.schema.json' with { type: 'json' };
import type { EventEnvelope } from './event-envelope.types.js';
import { eventRegistry } from './event-registry.js';
import type { EventContractKey, EventOf } from './event-registry.types.js';

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

type RuntimeContract = EventContractDefinition<string, string, string, object>;

/**
 * Validates decoded domain events against the contract selected by its
 * versioned routing key. The class is framework-neutral and compiles every
 * registered schema once during construction.
 */
export class AccountEventContractValidator {
  private readonly envelopeValidator: ValidateFunction<EventEnvelope>;
  private readonly eventValidators = new Map<
    EventContractKey,
    ValidateFunction
  >();

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

    ajv.addSchema(eventEnvelopeSchema);
    this.envelopeValidator = ajv.getSchema<EventEnvelope>(
      eventEnvelopeSchema.$id,
    )!;

    for (const [key, contract] of Object.entries(eventRegistry) as Array<
      [EventContractKey, RuntimeContract]
    >) {
      this.eventValidators.set(key, ajv.compile(contract.schema));
    }
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

  validate<TKey extends EventContractKey>(
    key: TKey,
    input: unknown,
  ): ContractValidationResult<EventOf<TKey>, EventContractFailureCode> {
    const envelope = this.validateEnvelope(input);
    if (!envelope.valid) {
      return envelope;
    }

    const contract = eventRegistry[key];
    if (envelope.value.eventType !== contract.eventType) {
      return unsupportedEvent(contract.eventType);
    }
    if (envelope.value.publisher !== contract.publisher) {
      return invalidPublisher(contract.publisher);
    }

    const validator = this.eventValidators.get(key)! as ValidateFunction<
      EventOf<TKey>
    >;
    if (!validator(input)) {
      return failure('INVALID_PAYLOAD', sanitizeViolations(validator.errors));
    }

    return { valid: true, value: input };
  }
}
