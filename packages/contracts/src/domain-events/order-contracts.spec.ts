import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AccountEventContractValidator } from './account-event-contract.validator.js';
import type { EventContractKey } from './event-registry.types.js';

const id = () => randomUUID();
const envelope = (
  eventType: string,
  publisher: string,
  payload: Record<string, unknown>,
) => ({
  eventId: id(),
  eventType,
  timestamp: '2026-10-11T08:30:00.000Z',
  publisher,
  payload,
});

const validContracts = [
  [
    'order.errand-completed.v1',
    envelope('ErrandCompleted', 'order-service', {
      errandId: id(),
      requesterUserId: id(),
      courierUserId: id(),
      amount: 50,
    }),
  ],
  [
    'order.errand-cancelled.v1',
    envelope('ErrandCancelled', 'order-service', { errandId: id() }),
  ],
  [
    'credit.transfer-succeeded.v1',
    envelope('CreditTransferSucceeded', 'credit-service', {
      errandId: id(),
      requesterUserId: id(),
      courierUserId: id(),
      transferredAmount: 50,
      creditTransactionId: id(),
    }),
  ],
  [
    'credit.transfer-rejected.v1',
    envelope('CreditTransferRejected', 'credit-service', {
      errandId: id(),
      requesterUserId: id(),
      courierUserId: id(),
      rejectionReason: 'DESTINATION_ARCHIVED',
    }),
  ],
  [
    'credit.release-rejected.v1',
    envelope('CreditReleaseRejected', 'credit-service', {
      errandId: id(),
      requesterUserId: id(),
      rejectionReason: 'RESERVATION_NOT_FOUND',
    }),
  ],
] as const satisfies ReadonlyArray<readonly [EventContractKey, object]>;

describe('order errand event contracts', () => {
  const validator = new AccountEventContractValidator();

  it.each(validContracts)('accepts the exact %s contract', (key, event) => {
    expect(validator.validate(key, structuredClone(event))).toEqual({
      valid: true,
      value: event,
    });
  });

  it.each(validContracts)(
    'rejects unknown payload fields for %s',
    (key, event) => {
      const input = structuredClone(event) as {
        payload: Record<string, unknown>;
      };
      input.payload.privateValue = 'do-not-accept';
      expect(validator.validate(key, input)).toMatchObject({
        valid: false,
        code: 'INVALID_PAYLOAD',
      });
    },
  );

  it.each(validContracts)('rejects a wrong publisher for %s', (key, event) => {
    const input = {
      ...structuredClone(event),
      publisher:
        event.publisher === 'order-service'
          ? 'credit-service'
          : 'order-service',
    };
    expect(validator.validate(key, input)).toMatchObject({
      valid: false,
      code: 'INVALID_ENVELOPE',
    });
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects unsafe amount %s',
    (amount) => {
      const completed = structuredClone(validContracts[0][1]);
      completed.payload.amount = amount;
      expect(
        validator.validate('order.errand-completed.v1', completed),
      ).toMatchObject({ valid: false, code: 'INVALID_PAYLOAD' });

      const transferred = structuredClone(validContracts[2][1]);
      transferred.payload.transferredAmount = amount;
      expect(
        validator.validate('credit.transfer-succeeded.v1', transferred),
      ).toMatchObject({ valid: false, code: 'INVALID_PAYLOAD' });
    },
  );

  it.each([
    ['credit.transfer-rejected.v1', 3],
    ['credit.release-rejected.v1', 4],
  ] as const)('enforces rejection reasons for %s', (key, index) => {
    const input = structuredClone(validContracts[index][1]);
    input.payload.rejectionReason = 'UNKNOWN';
    expect(validator.validate(key, input)).toMatchObject({
      valid: false,
      code: 'INVALID_PAYLOAD',
    });
  });
});
