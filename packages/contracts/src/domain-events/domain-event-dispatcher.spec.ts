import { describe, expect, it, vi } from 'vitest';
import { AccountEventContractValidator } from './account-event-contract.validator.js';
import { DomainEventDispatcher } from './domain-event-dispatcher.js';
import { USER_REGISTERED_V1_ROUTING_KEY } from './events/user-registered/v1/contract.js';

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

describe('DomainEventDispatcher', () => {
  const dispatcher = new DomainEventDispatcher(
    new AccountEventContractValidator(),
  );

  it('routes a validated event to the handler for its routing key', async () => {
    const handler = vi.fn();

    const result = await dispatcher.dispatch(
      USER_REGISTERED_V1_ROUTING_KEY,
      structuredClone(userRegistered),
      { [USER_REGISTERED_V1_ROUTING_KEY]: handler },
    );

    expect(result).toEqual({ outcome: 'handled' });
    expect(handler).toHaveBeenCalledWith(userRegistered);
  });

  it('awaits an asynchronous handler before reporting handled', async () => {
    let settled = false;

    const result = await dispatcher.dispatch(
      USER_REGISTERED_V1_ROUTING_KEY,
      structuredClone(userRegistered),
      {
        [USER_REGISTERED_V1_ROUTING_KEY]: async () => {
          await Promise.resolve();
          settled = true;
        },
      },
    );

    expect(result).toEqual({ outcome: 'handled' });
    expect(settled).toBe(true);
  });

  it('skips a registered event that this subscriber does not handle', async () => {
    const result = await dispatcher.dispatch(
      USER_REGISTERED_V1_ROUTING_KEY,
      structuredClone(userRegistered),
      {},
    );

    expect(result).toEqual({
      outcome: 'skipped',
      routingKey: USER_REGISTERED_V1_ROUTING_KEY,
    });
  });

  it('reports an invalid message instead of calling a handler', async () => {
    const handler = vi.fn();
    const input = structuredClone(userRegistered);
    input.payload.email = 'not-an-email';

    const result = await dispatcher.dispatch(
      USER_REGISTERED_V1_ROUTING_KEY,
      input,
      { [USER_REGISTERED_V1_ROUTING_KEY]: handler },
    );

    expect(result).toMatchObject({
      outcome: 'invalid',
      code: 'INVALID_PAYLOAD',
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('skips an unregistered routing key before contract validation', async () => {
    const result = await dispatcher.dispatch('user.deleted.v1', {}, {});

    expect(result).toEqual({
      outcome: 'skipped',
      routingKey: 'user.deleted.v1',
    });
  });

  it('skips a malformed registered event when no handler is installed', async () => {
    const result = await dispatcher.dispatch(
      USER_REGISTERED_V1_ROUTING_KEY,
      { malformed: true },
      {},
    );

    expect(result).toEqual({
      outcome: 'skipped',
      routingKey: USER_REGISTERED_V1_ROUTING_KEY,
    });
  });
});
