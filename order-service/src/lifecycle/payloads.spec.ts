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

  it('keeps the supplier snapshot on SupplierValidated, with the reply it came from', () => {
    const supplier = { status: 'Active', version: 3, name: 'Cool Spot' };
    expect(payloadValid('SupplierValidated', { supplierEventId: randomUUID(), supplier })).toBe(true);
    expect(payloadValid('SupplierValidated', { supplierEventId: randomUUID() })).toBe(false);
    expect(payloadValid('SupplierValidated', { supplier })).toBe(false);
  });

  it('takes a supplier cancel with both its details, never mixed with credit ones', () => {
    const supplierEventId = randomUUID();
    expect(payloadValid('ErrandCancelled', { supplierEventId, supplierOutcome: 'NOT_FOUND' })).toBe(true);
    expect(payloadValid('ErrandCancelled', { supplierEventId, supplierOutcome: 'INACTIVE' })).toBe(true);
    expect(
      payloadValid('ErrandCancelled', { supplierEventId, supplierOutcome: 'BUILDING_NOT_FOUND' }),
    ).toBe(true);
    expect(payloadValid('ErrandCancelled', { supplierEventId })).toBe(false);
    expect(payloadValid('ErrandCancelled', { supplierEventId, supplierOutcome: 'GONE' })).toBe(false);
    expect(
      payloadValid('ErrandCancelled', {
        supplierEventId,
        supplierOutcome: 'NOT_FOUND',
        creditEventId: randomUUID(),
        requestedAmount: 5,
      }),
    ).toBe(false);
  });

  it('takes a cancel with or without credit details, never half of them', () => {
    expect(payloadValid('ErrandCancelled', {})).toBe(true);
    expect(
      payloadValid('ErrandCancelled', { creditEventId: randomUUID(), requestedAmount: 5 }),
    ).toBe(true);
    expect(payloadValid('ErrandCancelled', { creditEventId: randomUUID() })).toBe(false);
  });
});
