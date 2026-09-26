import { describe, expect, it } from 'vitest';
import { AccountEventContractValidator } from './account-event-contract.validator.js';
import { eventRegistry } from './event-registry.js';

describe('eventRegistry', () => {
  it('uses each descriptor routing key as its registry key', () => {
    for (const [key, contract] of Object.entries(eventRegistry)) {
      expect(contract.routingKey).toBe(key);
    }
  });

  it('contains unique schema identifiers', () => {
    const schemaIds = Object.values(eventRegistry).map(
      ({ schema }) => schema.$id,
    );

    expect(new Set(schemaIds).size).toBe(schemaIds.length);
    expect(schemaIds.every((schemaId) => typeof schemaId === 'string')).toBe(
      true,
    );
  });

  it('compiles every registered schema', () => {
    expect(() => new AccountEventContractValidator()).not.toThrow();
  });
});
