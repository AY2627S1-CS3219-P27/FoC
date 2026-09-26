import { describe, expect, it } from 'vitest';
import { AccountEventContractValidator } from '../../../account-event-contract.validator.js';
import {
  CREDIT_ACCOUNT_INITIALISED_V1_ROUTING_KEY,
  creditAccountInitialisedV1Contract,
} from './contract.js';

const validEvent = {
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

function copy() {
  return structuredClone(validEvent);
}

describe('CreditAccountInitialised v1 contract', () => {
  const validator = new AccountEventContractValidator();

  it('declares its canonical metadata', () => {
    expect(creditAccountInitialisedV1Contract).toMatchObject({
      routingKey: 'credit.account-initialised.v1',
      eventType: 'CreditAccountInitialised',
      publisher: 'credit-service',
    });
  });

  it('accepts the exact event contract', () => {
    expect(
      validator.validate(CREDIT_ACCOUNT_INITIALISED_V1_ROUTING_KEY, copy()),
    ).toEqual({ valid: true, value: validEvent });
  });

  it.each(['userId', 'creditAmountAllocated', 'creditAllocationId'])(
    'rejects a missing payload field: %s',
    (field) => {
      const input = copy();
      delete (input.payload as Record<string, unknown>)[field];

      expect(
        validator.validate(CREDIT_ACCOUNT_INITIALISED_V1_ROUTING_KEY, input),
      ).toMatchObject({ valid: false, code: 'INVALID_PAYLOAD' });
    },
  );

  it('rejects additional payload fields', () => {
    const input = copy();
    Object.assign(input.payload, { creditBalance: 100 });

    expect(
      validator.validate(CREDIT_ACCOUNT_INITIALISED_V1_ROUTING_KEY, input),
    ).toMatchObject({ valid: false, code: 'INVALID_PAYLOAD' });
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid allocated amount %s',
    (creditAmountAllocated) => {
      const input = copy();
      input.payload.creditAmountAllocated = creditAmountAllocated;

      expect(
        validator.validate(CREDIT_ACCOUNT_INITIALISED_V1_ROUTING_KEY, input),
      ).toMatchObject({ valid: false, code: 'INVALID_PAYLOAD' });
    },
  );

  it.each(['userId', 'creditAllocationId'])(
    'rejects an invalid %s',
    (field) => {
      const input = copy();
      (input.payload as Record<string, unknown>)[field] = 'not-a-uuid';

      expect(
        validator.validate(CREDIT_ACCOUNT_INITIALISED_V1_ROUTING_KEY, input),
      ).toMatchObject({ valid: false, code: 'INVALID_PAYLOAD' });
    },
  );
});
