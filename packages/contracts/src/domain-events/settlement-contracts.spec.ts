import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AccountEventContractValidator } from './account-event-contract.validator.js';

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

const REQUEST = 'credit.settlement.v1';
const SUCCEEDED = 'credit.settlement-succeeded.v1';
const REJECTED = 'credit.settlement-rejected.v1';

const request = () =>
  envelope('CreditSettlementRequested', 'order-service', {
    errandId: id(),
    requesterUserId: id(),
    courierUserId: id(),
    courierAmount: 30,
    requesterAmount: 20,
    attempt: 1,
  });
const succeeded = () =>
  envelope('CreditSettlementSucceeded', 'credit-service', {
    errandId: id(),
    requesterUserId: id(),
    courierUserId: id(),
    courierAmount: 30,
    requesterAmount: 20,
    creditTransactionId: id(),
  });
const rejected = () =>
  envelope('CreditSettlementRejected', 'credit-service', {
    errandId: id(),
    requesterUserId: id(),
    courierUserId: id(),
    rejectionReason: 'AMOUNT_MISMATCH',
  });

const contracts = [
  [REQUEST, request],
  [SUCCEEDED, succeeded],
  [REJECTED, rejected],
] as const;

describe('credit settlement event contracts', () => {
  const validator = new AccountEventContractValidator();

  it.each(contracts)('accepts the exact %s contract', (key, make) => {
    const event = make();
    expect(validator.validate(key, structuredClone(event))).toEqual({
      valid: true,
      value: event,
    });
  });

  it.each(contracts)('rejects unknown payload fields for %s', (key, make) => {
    const event = make();
    (event.payload as Record<string, unknown>).extra = 1;
    expect(validator.validate(key, event)).toMatchObject({
      valid: false,
      code: 'INVALID_PAYLOAD',
    });
  });

  it.each(contracts)('rejects a wrong publisher for %s', (key, make) => {
    const event = make();
    const publisher =
      event.publisher === 'order-service' ? 'credit-service' : 'order-service';
    expect(validator.validate(key, { ...event, publisher })).toMatchObject({
      valid: false,
      code: 'INVALID_ENVELOPE',
    });
  });

  it.each(contracts)('rejects a non-UUID party id for %s', (key, make) => {
    for (const field of ['errandId', 'requesterUserId', 'courierUserId']) {
      const event = make();
      (event.payload as Record<string, unknown>)[field] = 'not-a-uuid';
      expect(validator.validate(key, event)).toMatchObject({
        valid: false,
        code: 'INVALID_PAYLOAD',
      });
    }
  });

  it.each([
    [REQUEST, request, 'courierAmount'],
    [REQUEST, request, 'requesterAmount'],
    [REQUEST, request, 'attempt'],
    [SUCCEEDED, succeeded, 'courierAmount'],
    [SUCCEEDED, succeeded, 'requesterAmount'],
    [SUCCEEDED, succeeded, 'creditTransactionId'],
    [REJECTED, rejected, 'rejectionReason'],
  ] as const)('requires %s payload field %s', (key, make, field) => {
    const event = make();
    delete (event.payload as Record<string, unknown>)[field];
    expect(validator.validate(key, event)).toMatchObject({
      valid: false,
      code: 'INVALID_PAYLOAD',
    });
  });

  it('allows a zero share for either party (full refund or full payout)', () => {
    for (const [key, make] of [
      [REQUEST, request],
      [SUCCEEDED, succeeded],
    ] as const) {
      for (const field of ['courierAmount', 'requesterAmount']) {
        const event = make();
        (event.payload as Record<string, unknown>)[field] = 0;
        expect(validator.validate(key, event)).toMatchObject({ valid: true });
      }
    }
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects unsafe amount %s',
    (amount) => {
      for (const [key, make] of [
        [REQUEST, request],
        [SUCCEEDED, succeeded],
      ] as const) {
        for (const field of ['courierAmount', 'requesterAmount']) {
          const event = make();
          (event.payload as Record<string, unknown>)[field] = amount;
          expect(validator.validate(key, event)).toMatchObject({
            valid: false,
            code: 'INVALID_PAYLOAD',
          });
        }
      }
    },
  );

  it.each([0, -1, 1.5])('rejects attempt %s', (attempt) => {
    const event = request();
    event.payload.attempt = attempt;
    expect(validator.validate(REQUEST, event)).toMatchObject({
      valid: false,
      code: 'INVALID_PAYLOAD',
    });
  });

  it.each([
    'RESERVATION_NOT_FOUND',
    'RESERVATION_RELEASED',
    'RESERVATION_USER_MISMATCH',
    'DESTINATION_ARCHIVED',
    'AMOUNT_MISMATCH',
  ])('accepts rejection reason %s', (rejectionReason) => {
    const event = rejected();
    event.payload.rejectionReason = rejectionReason;
    expect(validator.validate(REJECTED, event)).toMatchObject({ valid: true });
  });

  it('rejects an unknown rejection reason', () => {
    const event = rejected();
    event.payload.rejectionReason = 'UNKNOWN';
    expect(validator.validate(REJECTED, event)).toMatchObject({
      valid: false,
      code: 'INVALID_PAYLOAD',
    });
  });

  it('rejects an event validated against the wrong settlement route', () => {
    expect(validator.validate(SUCCEEDED, rejected())).toMatchObject({
      valid: false,
      code: 'UNSUPPORTED_EVENT_TYPE',
    });
  });
});
