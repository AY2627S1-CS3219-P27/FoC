import { randomUUID } from 'node:crypto';
import { EDGES } from './edges.js';
import { PAYLOADS, payloadValid } from './payloads.js';

const edgeTypes = Object.values(EDGES)
  .flatMap((tos) => Object.values(tos ?? {}))
  .flat()
  .map((e) => e!.type);

describe('payloadValid', () => {
  it('has a schema for every edge event type, and none spare', () => {
    expect(Object.keys(PAYLOADS).sort()).toEqual([...new Set(edgeTypes)].sort());
  });

  it('refuses an event type with no schema', () => {
    expect(payloadValid('Unknown', {})).toBe(false);
  });

  it('treats a missing payload as empty', () => {
    expect(payloadValid('ErrandAccepted', undefined)).toBe(true);
    expect(payloadValid('AdjustmentRequested', undefined)).toBe(false);
  });

  it('refuses unknown keys, including projection column names', () => {
    expect(payloadValid('ErrandAccepted', { note: 'hi' })).toBe(false);
    expect(payloadValid('ErrandAccepted', { courierId: randomUUID() })).toBe(false);
    expect(payloadValid('ErrandCancelled', { cancellationReason: 'ERRAND_EXPIRED' })).toBe(false);
  });

  it('checks field types', () => {
    expect(payloadValid('AdjustmentRequested', { newAmount: 9 })).toBe(true);
    expect(payloadValid('AdjustmentRequested', { newAmount: 0 })).toBe(false);
    expect(payloadValid('AdjustmentRequested', { newAmount: '9' })).toBe(false);
    expect(
      payloadValid('CreditReserved', {
        creditEventId: 'not-a-uuid',
        creditTransactionId: randomUUID(),
        reservedAmount: 5,
      }),
    ).toBe(false);
  });

  it('requires a non-blank reason when the courier withdraws (F7.4)', () => {
    expect(payloadValid('CourierWithdrew', { reason: 'bike broke down' })).toBe(true);
    expect(payloadValid('CourierWithdrew', {})).toBe(false);
    expect(payloadValid('CourierWithdrew', { reason: '   ' })).toBe(false);
    expect(payloadValid('CourierWithdrew', { reason: 'x'.repeat(501) })).toBe(false);
  });

  it('takes a cancel with or without credit details, never half of them', () => {
    expect(payloadValid('ErrandCancelled', {})).toBe(true);
    expect(
      payloadValid('ErrandCancelled', { creditEventId: randomUUID(), requestedAmount: 5 }),
    ).toBe(true);
    expect(payloadValid('ErrandCancelled', { creditEventId: randomUUID() })).toBe(false);
  });
});
