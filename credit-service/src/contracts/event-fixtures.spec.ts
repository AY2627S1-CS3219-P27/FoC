import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  AccountEventContractValidator,
  CREDIT_RESERVATION_ADJUSTMENT_V1_ROUTING_KEY,
  CREDIT_RESERVATION_V1_ROUTING_KEY,
  type EventContractKey,
} from '@foc/contracts';

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(
    await readFile(resolve(process.cwd(), 'test', 'fixtures', name), 'utf8'),
  );
}

describe('reservation command fixtures', () => {
  const contracts = new AccountEventContractValidator();

  it.each([
    ['credit-reservation.v1.json', CREDIT_RESERVATION_V1_ROUTING_KEY],
    [
      'credit-reservation-adjustment.v1.json',
      CREDIT_RESERVATION_ADJUSTMENT_V1_ROUTING_KEY,
    ],
  ] as const satisfies ReadonlyArray<readonly [string, EventContractKey]>)(
    'keeps %s valid for its published route',
    async (name, routingKey) => {
      expect(contracts.validate(routingKey, await fixture(name))).toMatchObject(
        {
          valid: true,
        },
      );
    },
  );

  it.each([
    ['credit-reservation.invalid.v1.json', CREDIT_RESERVATION_V1_ROUTING_KEY],
    [
      'credit-reservation-adjustment.invalid.v1.json',
      CREDIT_RESERVATION_ADJUSTMENT_V1_ROUTING_KEY,
    ],
  ] as const satisfies ReadonlyArray<readonly [string, EventContractKey]>)(
    'keeps %s intentionally invalid for DLQ testing',
    async (name, routingKey) => {
      expect(contracts.validate(routingKey, await fixture(name))).toMatchObject(
        {
          valid: false,
          code: 'INVALID_PAYLOAD',
        },
      );
    },
  );
});
