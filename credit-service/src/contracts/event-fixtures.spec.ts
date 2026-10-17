import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  AccountEventContractValidator,
  CREDIT_RESERVATION_ADJUSTMENT_V1_ROUTING_KEY,
  CREDIT_RESERVATION_V1_ROUTING_KEY,
  ORDER_ERRAND_COMPLETED_V1_ROUTING_KEY,
  ORDER_ERRAND_CANCELLED_V1_ROUTING_KEY,
  USER_REGISTERED_V1_ROUTING_KEY,
  type EventContractKey,
} from '@foc/contracts';

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(
    await readFile(resolve(process.cwd(), 'test', 'fixtures', name), 'utf8'),
  );
}

describe('Credit command fixtures', () => {
  const contracts = new AccountEventContractValidator();

  it.each([
    ['user-registered.v1.json', USER_REGISTERED_V1_ROUTING_KEY],
    ['user-registered-courier.v1.json', USER_REGISTERED_V1_ROUTING_KEY],
    ['credit-reservation.v1.json', CREDIT_RESERVATION_V1_ROUTING_KEY],
    [
      'credit-reservation-adjustment.v1.json',
      CREDIT_RESERVATION_ADJUSTMENT_V1_ROUTING_KEY,
    ],
    ['errand-completed.v1.json', ORDER_ERRAND_COMPLETED_V1_ROUTING_KEY],
    [
      'errand-completed-participant-mismatch.v1.json',
      ORDER_ERRAND_COMPLETED_V1_ROUTING_KEY,
    ],
    ['errand-cancelled.v1.json', ORDER_ERRAND_CANCELLED_V1_ROUTING_KEY],
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

  it.each([
    ['errand-completed-invalid-amount.v1.json', 'INVALID_PAYLOAD'],
    ['errand-completed-malformed-envelope.v1.json', 'INVALID_ENVELOPE'],
    ['errand-completed-unknown-field.v1.json', 'INVALID_PAYLOAD'],
  ] as const)(
    'keeps %s intentionally invalid for completion DLQ testing',
    async (name, code) => {
      expect(
        contracts.validate(
          ORDER_ERRAND_COMPLETED_V1_ROUTING_KEY,
          await fixture(name),
        ),
      ).toMatchObject({ valid: false, code });
    },
  );

  it.each([
    ['errand-cancelled-invalid-uuid.v1.json', 'INVALID_PAYLOAD'],
    ['errand-cancelled-malformed-envelope.v1.json', 'INVALID_ENVELOPE'],
    ['errand-cancelled-wrong-publisher.v1.json', 'INVALID_ENVELOPE'],
    ['errand-cancelled-unknown-field.v1.json', 'INVALID_PAYLOAD'],
  ] as const)(
    'keeps %s intentionally invalid for cancellation DLQ testing',
    async (name, code) => {
      expect(
        contracts.validate(
          ORDER_ERRAND_CANCELLED_V1_ROUTING_KEY,
          await fixture(name),
        ),
      ).toMatchObject({ valid: false, code });
    },
  );
});
