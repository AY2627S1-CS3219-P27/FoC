import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AccountEventContractValidator } from './account-event-contract.validator.js';
import type { EventContractKey } from './event-registry.types.js';
import {
  CREDIT_RELEASE_REJECTED_V1_ROUTING_KEY,
  type CreditReleaseRejectionReason,
} from './events/credit-release-rejected/v1/contract.js';
import { CREDIT_RELEASE_SUCCESS_V1_ROUTING_KEY } from './events/credit-release-success/v1/contract.js';
import type { CreditTransferRejectionReason } from './events/credit-transfer-rejected/v1/contract.js';

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
    CREDIT_RELEASE_SUCCESS_V1_ROUTING_KEY,
    envelope('CreditReleaseSuccess', 'credit-service', {
      errandId: id(),
      requesterUserId: id(),
      releasedAmount: 50,
      creditTransactionId: id(),
    }),
  ],
  [
    CREDIT_RELEASE_REJECTED_V1_ROUTING_KEY,
    envelope('CreditReleaseRejected', 'credit-service', {
      errandId: id(),
      requesterUserId: id(),
      rejectionReason: 'RESERVATION_NOT_FOUND',
    }),
  ],
] as const satisfies ReadonlyArray<readonly [EventContractKey, object]>;

const releaseRejectionReasons = [
  'RESERVATION_NOT_FOUND',
  'ALREADY_TRANSFERRED',
] as const satisfies ReadonlyArray<CreditReleaseRejectionReason>;

const transferRejectionReasons = [
  'DESTINATION_ARCHIVED',
  'RESERVATION_NOT_FOUND',
  'RESERVATION_RELEASED',
  'RESERVATION_USER_MISMATCH',
] as const satisfies ReadonlyArray<CreditTransferRejectionReason>;

const transferContracts = [
  validContracts[0],
  validContracts[2],
  validContracts[3],
] as const;

const releaseContracts = [validContracts[4], validContracts[5]] as const;

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

      const released = structuredClone(validContracts[4][1]);
      released.payload.releasedAmount = amount;
      expect(
        validator.validate(CREDIT_RELEASE_SUCCESS_V1_ROUTING_KEY, released),
      ).toMatchObject({ valid: false, code: 'INVALID_PAYLOAD' });
    },
  );

  it.each(transferRejectionReasons)(
    'accepts transfer rejection reason %s',
    (rejectionReason) => {
      const input = structuredClone(validContracts[3][1]);
      input.payload.rejectionReason = rejectionReason;

      expect(validator.validate('credit.transfer-rejected.v1', input)).toEqual({
        valid: true,
        value: input,
      });
    },
  );

  it.each(['STALE_RESERVATION_AMOUNT', 'UNKNOWN'])(
    'rejects unsupported transfer rejection reason %s',
    (rejectionReason) => {
      const input = structuredClone(validContracts[3][1]);
      input.payload.rejectionReason = rejectionReason;

      expect(
        validator.validate('credit.transfer-rejected.v1', input),
      ).toMatchObject({ valid: false, code: 'INVALID_PAYLOAD' });
    },
  );

  it.each(releaseRejectionReasons)(
    'accepts release rejection reason %s',
    (rejectionReason) => {
      const input = structuredClone(validContracts[5][1]);
      input.payload.rejectionReason = rejectionReason;

      expect(
        validator.validate(CREDIT_RELEASE_REJECTED_V1_ROUTING_KEY, input),
      ).toEqual({ valid: true, value: input });
    },
  );

  it.each(['RESERVATION_RELEASED', 'UNKNOWN'])(
    'rejects unsupported release rejection reason %s',
    (rejectionReason) => {
      const input = structuredClone(validContracts[5][1]);
      input.payload.rejectionReason = rejectionReason;

      expect(
        validator.validate(CREDIT_RELEASE_REJECTED_V1_ROUTING_KEY, input),
      ).toMatchObject({ valid: false, code: 'INVALID_PAYLOAD' });
    },
  );

  it.each(transferContracts)(
    'rejects a non-canonical timestamp for %s',
    (key, event) => {
      const input = { ...structuredClone(event), timestamp: 'not-a-date' };
      expect(validator.validate(key, input)).toMatchObject({
        valid: false,
        code: 'INVALID_ENVELOPE',
      });
    },
  );

  it.each(releaseContracts)(
    'rejects a non-canonical timestamp for %s',
    (key, event) => {
      const input = { ...structuredClone(event), timestamp: 'not-a-date' };
      expect(validator.validate(key, input)).toMatchObject({
        valid: false,
        code: 'INVALID_ENVELOPE',
      });
    },
  );

  it.each(transferContracts)(
    'rejects a non-UUID event ID for %s',
    (key, event) => {
      const input = { ...structuredClone(event), eventId: 'not-a-uuid' };
      expect(validator.validate(key, input)).toMatchObject({
        valid: false,
        code: 'INVALID_ENVELOPE',
      });
    },
  );

  it.each(releaseContracts)(
    'rejects a non-UUID event ID for %s',
    (key, event) => {
      const input = { ...structuredClone(event), eventId: 'not-a-uuid' };
      expect(validator.validate(key, input)).toMatchObject({
        valid: false,
        code: 'INVALID_ENVELOPE',
      });
    },
  );

  it.each([
    ['order.errand-completed.v1', 0, 'errandId'],
    ['order.errand-completed.v1', 0, 'requesterUserId'],
    ['order.errand-completed.v1', 0, 'courierUserId'],
    ['credit.transfer-succeeded.v1', 2, 'errandId'],
    ['credit.transfer-succeeded.v1', 2, 'requesterUserId'],
    ['credit.transfer-succeeded.v1', 2, 'courierUserId'],
    ['credit.transfer-succeeded.v1', 2, 'creditTransactionId'],
    ['credit.transfer-rejected.v1', 3, 'errandId'],
    ['credit.transfer-rejected.v1', 3, 'requesterUserId'],
    ['credit.transfer-rejected.v1', 3, 'courierUserId'],
    [CREDIT_RELEASE_SUCCESS_V1_ROUTING_KEY, 4, 'errandId'],
    [CREDIT_RELEASE_SUCCESS_V1_ROUTING_KEY, 4, 'requesterUserId'],
    [CREDIT_RELEASE_SUCCESS_V1_ROUTING_KEY, 4, 'creditTransactionId'],
    [CREDIT_RELEASE_REJECTED_V1_ROUTING_KEY, 5, 'errandId'],
    [CREDIT_RELEASE_REJECTED_V1_ROUTING_KEY, 5, 'requesterUserId'],
  ] as const)('rejects a non-UUID %s payload field %s', (key, index, field) => {
    const input = structuredClone(validContracts[index][1]);
    input.payload[field] = 'not-a-uuid';

    expect(validator.validate(key, input)).toMatchObject({
      valid: false,
      code: 'INVALID_PAYLOAD',
    });
  });

  it.each([
    ['order.errand-completed.v1', 0, 'ErrandCompletion'],
    ['credit.transfer-succeeded.v1', 2, 'CreditTransferSuccess'],
    ['credit.transfer-rejected.v1', 3, 'CreditTransferReject'],
    [CREDIT_RELEASE_SUCCESS_V1_ROUTING_KEY, 4, 'CreditReleasedSuccess'],
    [CREDIT_RELEASE_REJECTED_V1_ROUTING_KEY, 5, 'CreditReleaseReject'],
  ] as const)(
    'rejects a non-canonical event name on %s',
    (key, index, eventType) => {
      const input = { ...structuredClone(validContracts[index][1]), eventType };

      expect(validator.validate(key, input)).toMatchObject({
        valid: false,
        code: 'UNSUPPORTED_EVENT_TYPE',
      });
    },
  );

  it.each([
    ['credit.transfer-rejected.v1', 3],
    [CREDIT_RELEASE_REJECTED_V1_ROUTING_KEY, 5],
  ] as const)('enforces rejection reasons for %s', (key, index) => {
    const input = structuredClone(validContracts[index][1]);
    input.payload.rejectionReason = 'UNKNOWN';
    expect(validator.validate(key, input)).toMatchObject({
      valid: false,
      code: 'INVALID_PAYLOAD',
    });
  });

  it.each([
    [CREDIT_RELEASE_SUCCESS_V1_ROUTING_KEY, 4, 'errandId'],
    [CREDIT_RELEASE_SUCCESS_V1_ROUTING_KEY, 4, 'requesterUserId'],
    [CREDIT_RELEASE_SUCCESS_V1_ROUTING_KEY, 4, 'releasedAmount'],
    [CREDIT_RELEASE_SUCCESS_V1_ROUTING_KEY, 4, 'creditTransactionId'],
    [CREDIT_RELEASE_REJECTED_V1_ROUTING_KEY, 5, 'errandId'],
    [CREDIT_RELEASE_REJECTED_V1_ROUTING_KEY, 5, 'requesterUserId'],
    [CREDIT_RELEASE_REJECTED_V1_ROUTING_KEY, 5, 'rejectionReason'],
  ] as const)('requires %s payload field %s', (key, index, field) => {
    const input = structuredClone(validContracts[index][1]);
    delete (input.payload as Record<string, unknown>)[field];

    expect(validator.validate(key, input)).toMatchObject({
      valid: false,
      code: 'INVALID_PAYLOAD',
    });
  });

  it('rejects release events validated against the wrong release route', () => {
    expect(
      validator.validate(
        CREDIT_RELEASE_REJECTED_V1_ROUTING_KEY,
        structuredClone(validContracts[4][1]),
      ),
    ).toMatchObject({ valid: false, code: 'UNSUPPORTED_EVENT_TYPE' });
    expect(
      validator.validate(
        CREDIT_RELEASE_SUCCESS_V1_ROUTING_KEY,
        structuredClone(validContracts[5][1]),
      ),
    ).toMatchObject({ valid: false, code: 'UNSUPPORTED_EVENT_TYPE' });
  });
});
