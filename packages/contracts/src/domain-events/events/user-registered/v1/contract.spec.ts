import { describe, expect, it } from 'vitest';
import { AccountEventContractValidator } from '../../../account-event-contract.validator.js';
import {
  USER_REGISTERED_V1_ROUTING_KEY,
  userRegisteredV1Contract,
} from './contract.js';

const validEvent = {
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

function copy() {
  return structuredClone(validEvent);
}

describe('UserRegistered v1 contract', () => {
  const validator = new AccountEventContractValidator();

  it('declares its canonical metadata', () => {
    expect(userRegisteredV1Contract).toMatchObject({
      routingKey: 'user.registered.v1',
      eventType: 'UserRegistered',
      publisher: 'user-service',
    });
  });

  it('accepts the exact event contract', () => {
    expect(validator.validate(USER_REGISTERED_V1_ROUTING_KEY, copy())).toEqual({
      valid: true,
      value: validEvent,
    });
  });

  it.each(['userId', 'email', 'displayName'])(
    'rejects a missing payload field: %s',
    (field) => {
      const input = copy();
      delete (input.payload as Record<string, unknown>)[field];

      expect(
        validator.validate(USER_REGISTERED_V1_ROUTING_KEY, input),
      ).toMatchObject({ valid: false, code: 'INVALID_PAYLOAD' });
    },
  );

  it('rejects additional payload fields', () => {
    const input = copy();
    Object.assign(input.payload, { role: 'student' });

    expect(
      validator.validate(USER_REGISTERED_V1_ROUTING_KEY, input),
    ).toMatchObject({ valid: false, code: 'INVALID_PAYLOAD' });
  });

  it.each([
    ['user ID', { ...validEvent.payload, userId: 'not-a-uuid' }],
    ['email', { ...validEvent.payload, email: 'not-an-email' }],
    ['display name', { ...validEvent.payload, displayName: '' }],
  ])('rejects an invalid %s', (_, payload) => {
    const input = { ...copy(), payload };

    expect(
      validator.validate(USER_REGISTERED_V1_ROUTING_KEY, input),
    ).toMatchObject({ valid: false, code: 'INVALID_PAYLOAD' });
  });
});
