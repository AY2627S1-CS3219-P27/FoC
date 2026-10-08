import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AccountEventContractValidator } from './account-event-contract.validator.js';
import type { EventContractKey } from './event-registry.types.js';
import { CREDIT_RESERVATION_ADJUSTMENT_REJECTED_V1_ROUTING_KEY } from './events/credit-reservation-adjustment-rejected/v1/contract.js';
import { CREDIT_RESERVATION_ADJUSTMENT_SUCCESS_V1_ROUTING_KEY } from './events/credit-reservation-adjustment-success/v1/contract.js';
import { CREDIT_RESERVATION_ADJUSTMENT_V1_ROUTING_KEY } from './events/credit-reservation-adjustment/v1/contract.js';
import { CREDIT_RESERVATION_REJECTED_V1_ROUTING_KEY } from './events/credit-reservation-rejected/v1/contract.js';
import { CREDIT_RESERVATION_SUCCESS_V1_ROUTING_KEY } from './events/credit-reservation-success/v1/contract.js';
import { CREDIT_RESERVATION_V1_ROUTING_KEY } from './events/credit-reservation/v1/contract.js';

const id = () => randomUUID();
const envelope = (
  eventType: string,
  publisher: string,
  payload: Record<string, unknown>,
) => ({
  eventId: id(),
  eventType,
  timestamp: '2026-10-08T08:30:00.000Z',
  publisher,
  payload,
});

const validContracts = [
  [
    CREDIT_RESERVATION_V1_ROUTING_KEY,
    envelope('CreditReservation', 'order-service', {
      errandId: id(),
      requesterUserId: id(),
      amount: 50,
    }),
  ],
  [
    CREDIT_RESERVATION_ADJUSTMENT_V1_ROUTING_KEY,
    envelope('CreditReservationAdjustment', 'order-service', {
      errandId: id(),
      oldAmount: 50,
      newAmount: 75,
    }),
  ],
  [
    CREDIT_RESERVATION_SUCCESS_V1_ROUTING_KEY,
    envelope('CreditReservationSuccess', 'credit-service', {
      errandId: id(),
      requesterUserId: id(),
      reservedAmount: 50,
      creditTransactionId: id(),
    }),
  ],
  [
    CREDIT_RESERVATION_REJECTED_V1_ROUTING_KEY,
    envelope('CreditReservationRejected', 'credit-service', {
      errandId: id(),
      requesterUserId: id(),
      requestedAmount: 50,
      rejectionReason: 'INSUFFICIENT_CREDITS',
    }),
  ],
  [
    CREDIT_RESERVATION_ADJUSTMENT_SUCCESS_V1_ROUTING_KEY,
    envelope('CreditReservationAdjustmentSuccess', 'credit-service', {
      errandId: id(),
      newReservedAmount: 75,
      creditTransactionId: id(),
    }),
  ],
  [
    CREDIT_RESERVATION_ADJUSTMENT_REJECTED_V1_ROUTING_KEY,
    envelope('CreditReservationAdjustmentRejected', 'credit-service', {
      errandId: id(),
      requestedAmount: 75,
      rejectionReason: 'STALE_RESERVATION_AMOUNT',
    }),
  ],
] as const satisfies ReadonlyArray<readonly [EventContractKey, object]>;

describe('credit reservation event contracts', () => {
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

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects unsafe reservation amount %s',
    (amount) => {
      const input = structuredClone(validContracts[0][1]);
      input.payload.amount = amount;
      expect(
        validator.validate(CREDIT_RESERVATION_V1_ROUTING_KEY, input),
      ).toMatchObject({ valid: false, code: 'INVALID_PAYLOAD' });
    },
  );

  it.each(['oldAmount', 'newAmount'] as const)(
    'requires a positive adjustment %s',
    (field) => {
      const input = structuredClone(validContracts[1][1]);
      input.payload[field] = 0;
      expect(
        validator.validate(CREDIT_RESERVATION_ADJUSTMENT_V1_ROUTING_KEY, input),
      ).toMatchObject({ valid: false, code: 'INVALID_PAYLOAD' });
    },
  );

  it('enforces reservation rejection reasons', () => {
    const input = structuredClone(validContracts[3][1]);
    input.payload.rejectionReason = 'UNKNOWN';
    expect(
      validator.validate(CREDIT_RESERVATION_REJECTED_V1_ROUTING_KEY, input),
    ).toMatchObject({ valid: false, code: 'INVALID_PAYLOAD' });
  });

  it('enforces adjustment rejection reasons', () => {
    const input = structuredClone(validContracts[5][1]);
    input.payload.rejectionReason = 'RESERVATION_CONFLICT';
    expect(
      validator.validate(
        CREDIT_RESERVATION_ADJUSTMENT_REJECTED_V1_ROUTING_KEY,
        input,
      ),
    ).toMatchObject({ valid: false, code: 'INVALID_PAYLOAD' });
  });

  it('rejects the noncanonical adjusted-success alias', () => {
    const input = {
      ...structuredClone(validContracts[4][1]),
      eventType: 'CreditReservationAdjustedSuccess',
    };
    expect(
      validator.validate(
        CREDIT_RESERVATION_ADJUSTMENT_SUCCESS_V1_ROUTING_KEY,
        input,
      ),
    ).toMatchObject({ valid: false, code: 'UNSUPPORTED_EVENT_TYPE' });
  });

  it('requires the Order Service publisher for consumed commands', () => {
    const input = {
      ...structuredClone(validContracts[0][1]),
      publisher: 'credit-service',
    };
    expect(
      validator.validate(CREDIT_RESERVATION_V1_ROUTING_KEY, input),
    ).toMatchObject({ valid: false, code: 'INVALID_ENVELOPE' });
  });
});
