import { expectTypeOf, describe, expect, it } from 'vitest';
import { AccountEventContractValidator } from './account-event-contract.validator.js';
import { USER_REGISTERED_V1_ROUTING_KEY } from './events/user-registered/v1/contract.js';
import type { EventOf, UserRegisteredEvent } from './event-registry.types.js';

const userRegistered = {
  eventId: '19860606-e57b-4e8d-baa9-7f5b11293f41',
  eventType: 'UserRegistered',
  timestamp: '2026-09-22T08:30:00.000Z',
  publisher: 'user-service',
  payload: {
    userId: 'db3f2ca7-1f10-4fd3-965d-a721d26ba80b',
    email: 'student@u.nus.edu',
    displayName: 'Student One',
  },
};

function copy<T>(value: T): T {
  return structuredClone(value);
}

describe('AccountEventContractValidator', () => {
  const validator = new AccountEventContractValidator();

  it('accepts a valid common envelope without mutating it', () => {
    const input = copy(userRegistered);
    const before = copy(input);

    const result = validator.validateEnvelope(input);

    expect(result).toEqual({ valid: true, value: input });
    expect(input).toEqual(before);
  });

  it('dispatches by routing key and retains the registered event type', () => {
    const result = validator.validate(
      USER_REGISTERED_V1_ROUTING_KEY,
      copy(userRegistered),
    );

    expect(result).toEqual({ valid: true, value: userRegistered });
    if (result.valid) {
      expectTypeOf(result.value).toEqualTypeOf<UserRegisteredEvent>();
      expectTypeOf(result.value).toEqualTypeOf<EventOf<'user.registered.v1'>>();
    }
  });

  it.each(['eventId', 'eventType', 'timestamp', 'publisher', 'payload'])(
    'rejects a missing envelope field: %s',
    (field) => {
      const input = copy(userRegistered) as Record<string, unknown>;
      delete input[field];

      expect(
        validator.validate(USER_REGISTERED_V1_ROUTING_KEY, input),
      ).toMatchObject({ valid: false, code: 'INVALID_ENVELOPE' });
    },
  );

  it('rejects an additional envelope field', () => {
    const input = { ...copy(userRegistered), traceId: 'not-in-v1' };

    expect(
      validator.validate(USER_REGISTERED_V1_ROUTING_KEY, input),
    ).toMatchObject({ valid: false, code: 'INVALID_ENVELOPE' });
  });

  it.each([
    'not-a-date',
    '2026-09-22T16:30:00+08:00',
    '2026-09-22T08:30:00.000z',
  ])('rejects a non-canonical UTC timestamp: %s', (timestamp) => {
    const input = { ...copy(userRegistered), timestamp };

    expect(
      validator.validate(USER_REGISTERED_V1_ROUTING_KEY, input),
    ).toMatchObject({ valid: false, code: 'INVALID_ENVELOPE' });
  });

  it.each(['userregistered', 'UserDeleted'])(
    'classifies event type %s as unsupported',
    (eventType) => {
      const input = { ...copy(userRegistered), eventType };

      expect(
        validator.validate(USER_REGISTERED_V1_ROUTING_KEY, input),
      ).toMatchObject({ valid: false, code: 'UNSUPPORTED_EVENT_TYPE' });
    },
  );

  it.each(['user-Service', 'credit-service'])(
    'classifies publisher %s as an invalid envelope',
    (publisher) => {
      const input = { ...copy(userRegistered), publisher };

      expect(
        validator.validate(USER_REGISTERED_V1_ROUTING_KEY, input),
      ).toMatchObject({ valid: false, code: 'INVALID_ENVELOPE' });
    },
  );

  it('returns stable sanitized violations without event values', () => {
    const sensitiveValue = 'sensitive-value-that-must-not-appear';
    const input = copy(userRegistered);
    input.payload.email = sensitiveValue;

    const first = validator.validate(USER_REGISTERED_V1_ROUTING_KEY, input);
    const second = validator.validate(USER_REGISTERED_V1_ROUTING_KEY, input);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      valid: false,
      code: 'INVALID_PAYLOAD',
      violations: [
        {
          instancePath: '/payload/email',
          keyword: 'format',
          message: expect.any(String),
          schemaPath: expect.any(String),
        },
      ],
    });
    expect(JSON.stringify(first)).not.toContain(sensitiveValue);
  });
});
