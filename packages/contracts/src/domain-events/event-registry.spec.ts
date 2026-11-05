import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AccountEventContractValidator } from './account-event-contract.validator.js';
import { eventRegistry } from './event-registry.js';

const definitions = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../../../../rabbitmq/definitions.json', import.meta.url),
    ),
    'utf8',
  ),
) as {
  exchanges: Array<{ name: string; type: string; vhost: string }>;
  bindings: Array<{
    source: string;
    destination: string;
    destination_type: string;
    routing_key: string;
    vhost: string;
  }>;
};

const PUBSUB_EXCHANGE = 'foc.pubsub';

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

  it('declares the pub/sub exchange as a durable topic exchange', () => {
    expect(definitions.exchanges).toContainEqual({
      arguments: {},
      auto_delete: false,
      durable: true,
      name: PUBSUB_EXCHANGE,
      type: 'topic',
      vhost: '/foc',
    });
  });

  it('forwards exactly the event-kind contracts from foc.events to pub/sub', () => {
    const forwarded = definitions.bindings
      .filter(
        (binding) =>
          binding.source === 'foc.events' &&
          binding.destination === PUBSUB_EXCHANGE &&
          binding.destination_type === 'exchange' &&
          binding.vhost === '/foc',
      )
      .map((binding) => binding.routing_key)
      .sort();

    const expected = Object.values(eventRegistry)
      .filter((contract) => contract.kind === 'event')
      .map((contract) => contract.routingKey)
      .sort();

    expect(forwarded).toEqual(expected);
  });

  it('does not forward message contracts to pub/sub', () => {
    const forwarded = new Set(
      definitions.bindings
        .filter(
          (binding) =>
            binding.source === 'foc.events' &&
            binding.destination === PUBSUB_EXCHANGE &&
            binding.destination_type === 'exchange',
        )
        .map((binding) => binding.routing_key),
    );

    for (const contract of Object.values(eventRegistry)) {
      if (contract.kind === 'message') {
        expect(forwarded.has(contract.routingKey)).toBe(false);
      }
    }
  });
});
