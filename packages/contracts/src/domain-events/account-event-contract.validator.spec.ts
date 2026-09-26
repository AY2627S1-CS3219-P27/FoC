import { AccountEventContractValidator } from './account-event-contract.validator.js';

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

const creditAccountInitialised = {
  eventId: '470d52d6-f168-47a6-93b0-977e099fc28c',
  eventType: 'CreditAccountInitialised',
  timestamp: '2026-09-22T08:31:00.000Z',
  publisher: 'credit-service',
  payload: {
    userId: 'db3f2ca7-1f10-4fd3-965d-a721d26ba80b',
    creditAmountAllocated: 100,
    creditAllocationId: 'd8a889a1-994d-4e98-8a16-9f89de1a332f',
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

  it('accepts and types a complete UserRegistered event', () => {
    const input = copy(userRegistered);

    const result = validator.validateUserRegistered(input);

    expect(result).toEqual({ valid: true, value: input });
    if (result.valid) {
      expect(result.value.payload.userId).toBe(userRegistered.payload.userId);
      expect(result.value.payload.email).toBe(userRegistered.payload.email);
      expect(result.value.payload.displayName).toBe(
        userRegistered.payload.displayName,
      );
    }
  });

  it('accepts an exact CreditAccountInitialised event', () => {
    const input = copy(creditAccountInitialised);

    expect(validator.validateCreditAccountInitialised(input)).toEqual({
      valid: true,
      value: input,
    });
  });

  it.each(['eventId', 'eventType', 'timestamp', 'publisher', 'payload'])(
    'rejects a missing envelope field: %s',
    (field) => {
      const input = copy(userRegistered) as Record<string, unknown>;
      delete input[field];

      expect(validator.validateUserRegistered(input)).toMatchObject({
        valid: false,
        code: 'INVALID_ENVELOPE',
      });
    },
  );

  it('rejects an additional envelope field', () => {
    const input = { ...copy(userRegistered), traceId: 'not-in-v1' };

    expect(validator.validateUserRegistered(input)).toMatchObject({
      valid: false,
      code: 'INVALID_ENVELOPE',
    });
  });

  it.each(['userId', 'email', 'displayName'])(
    'rejects a missing UserRegistered payload field: %s',
    (field) => {
      const input = copy(userRegistered);
      delete (input.payload as Record<string, unknown>)[field];

      expect(validator.validateUserRegistered(input)).toMatchObject({
        valid: false,
        code: 'INVALID_PAYLOAD',
      });
    },
  );

  it('rejects additional UserRegistered payload fields', () => {
    const input = copy(userRegistered);
    Object.assign(input.payload, { role: 'student' });

    expect(validator.validateUserRegistered(input)).toMatchObject({
      valid: false,
      code: 'INVALID_PAYLOAD',
    });
  });

  it.each([
    ['event ID', { eventId: 'not-a-uuid' }],
    [
      'user ID',
      { payload: { ...userRegistered.payload, userId: 'not-a-uuid' } },
    ],
    [
      'email',
      { payload: { ...userRegistered.payload, email: 'not-an-email' } },
    ],
    [
      'display name',
      { payload: { ...userRegistered.payload, displayName: '' } },
    ],
  ])('rejects an invalid UserRegistered %s', (_, override) => {
    const input = { ...copy(userRegistered), ...override };

    expect(validator.validateUserRegistered(input)).toMatchObject({
      valid: false,
    });
  });

  it.each([
    'not-a-date',
    '2026-09-22T16:30:00+08:00',
    '2026-09-22T08:30:00.000z',
  ])('rejects a non-canonical UTC timestamp: %s', (timestamp) => {
    const input = { ...copy(userRegistered), timestamp };

    expect(validator.validateUserRegistered(input)).toMatchObject({
      valid: false,
      code: 'INVALID_ENVELOPE',
    });
  });

  it.each(['user-Service', 'credit-service'])(
    'rejects incorrect UserRegistered publisher %s',
    (publisher) => {
      const input = { ...copy(userRegistered), publisher };

      expect(validator.validateUserRegistered(input)).toMatchObject({
        valid: false,
        code: 'INVALID_ENVELOPE',
      });
    },
  );

  it.each(['userregistered', 'UserDeleted'])(
    'classifies event type %s as unsupported',
    (eventType) => {
      const input = { ...copy(userRegistered), eventType };

      expect(validator.validateUserRegistered(input)).toMatchObject({
        valid: false,
        code: 'UNSUPPORTED_EVENT_TYPE',
      });
    },
  );

  it.each(['userId', 'creditAmountAllocated', 'creditAllocationId'])(
    'rejects a missing CreditAccountInitialised payload field: %s',
    (field) => {
      const input = copy(creditAccountInitialised);
      delete (input.payload as Record<string, unknown>)[field];

      expect(validator.validateCreditAccountInitialised(input)).toMatchObject({
        valid: false,
        code: 'INVALID_PAYLOAD',
      });
    },
  );

  it('rejects additional CreditAccountInitialised payload fields', () => {
    const input = copy(creditAccountInitialised);
    Object.assign(input.payload, { creditBalance: 100 });

    expect(validator.validateCreditAccountInitialised(input)).toMatchObject({
      valid: false,
      code: 'INVALID_PAYLOAD',
    });
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid allocated amount %s',
    (creditAmountAllocated) => {
      const input = copy(creditAccountInitialised);
      input.payload.creditAmountAllocated = creditAmountAllocated;

      expect(validator.validateCreditAccountInitialised(input)).toMatchObject({
        valid: false,
        code: 'INVALID_PAYLOAD',
      });
    },
  );

  it.each(['userId', 'creditAllocationId'])(
    'rejects an invalid CreditAccountInitialised %s',
    (field) => {
      const input = copy(creditAccountInitialised);
      (input.payload as Record<string, unknown>)[field] = 'not-a-uuid';

      expect(validator.validateCreditAccountInitialised(input)).toMatchObject({
        valid: false,
        code: 'INVALID_PAYLOAD',
      });
    },
  );

  it('returns stable sanitized violations without event values', () => {
    const sensitiveValue = 'sensitive-value-that-must-not-appear';
    const input = copy(userRegistered);
    input.payload.email = sensitiveValue;

    const first = validator.validateUserRegistered(input);
    const second = validator.validateUserRegistered(input);

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
    if (!first.valid) {
      expect(Object.keys(first.violations[0]).sort()).toEqual([
        'instancePath',
        'keyword',
        'message',
        'schemaPath',
      ]);
    }
  });
});
