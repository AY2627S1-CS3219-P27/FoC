import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  AccountEventContractValidator,
  ORDER_COURIER_CANCELLED_V1_ROUTING_KEY,
  ORDER_ERRAND_ACCEPTED_V1_ROUTING_KEY,
  ORDER_ERRAND_CANCELLED_V1_ROUTING_KEY,
  ORDER_ERRAND_DELIVERED_V1_ROUTING_KEY,
  type EventContractKey,
} from '@foc/contracts';

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(
    await readFile(resolve(process.cwd(), 'test', 'fixtures', name), 'utf8'),
  );
}

describe('Communication lifecycle fixtures', () => {
  const contracts = new AccountEventContractValidator();

  it.each([
    ['errand-accepted.v1.json', ORDER_ERRAND_ACCEPTED_V1_ROUTING_KEY],
    ['errand-reaccepted.v1.json', ORDER_ERRAND_ACCEPTED_V1_ROUTING_KEY],
    ['errand-accepted-conflict.v1.json', ORDER_ERRAND_ACCEPTED_V1_ROUTING_KEY],
    ['errand-delivered.v1.json', ORDER_ERRAND_DELIVERED_V1_ROUTING_KEY],
    ['courier-cancelled.v1.json', ORDER_COURIER_CANCELLED_V1_ROUTING_KEY],
    ['errand-cancelled.v1.json', ORDER_ERRAND_CANCELLED_V1_ROUTING_KEY],
  ] as const satisfies ReadonlyArray<readonly [string, EventContractKey]>)(
    'keeps %s valid for its published route',
    async (name, routingKey) => {
      expect(contracts.validate(routingKey, await fixture(name))).toMatchObject(
        { valid: true },
      );
    },
  );

  it.each([
    ['errand-accepted-unknown-field.invalid.v1.json', 'INVALID_PAYLOAD'],
    ['errand-accepted-wrong-publisher.invalid.v1.json', 'INVALID_ENVELOPE'],
  ] as const)(
    'keeps %s intentionally invalid for DLQ testing',
    async (name, code) => {
      expect(
        contracts.validate(
          ORDER_ERRAND_ACCEPTED_V1_ROUTING_KEY,
          await fixture(name),
        ),
      ).toMatchObject({ valid: false, code });
    },
  );
});
