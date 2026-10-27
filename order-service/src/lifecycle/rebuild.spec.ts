import { foldEvents, type RebuildEvent } from './rebuild.js';

const errandId = '11111111-1111-1111-1111-111111111111';
const courier = '22222222-2222-2222-2222-222222222222';

const ev = (
  sequenceNumber: number,
  toStatus: RebuildEvent['toStatus'],
  payload: Record<string, unknown>,
): RebuildEvent => ({ errandId, sequenceNumber, toStatus, payload });

const created = ev(1, 'Pending-Supplier', {
  requesterId: '33333333-3333-3333-3333-333333333333',
  supplierId: '44444444-4444-4444-4444-444444444444',
  deliveryBuildingId: '55555555-5555-5555-5555-555555555555',
  deliveryDetail: 'Level 3 04-02',
  rewardCredits: 5,
  pickupLocation: null,
  description: null,
  expiresAt: null,
});

describe('foldEvents', () => {
  it('returns null for an errand with no events', () => {
    expect(foldEvents([])).toBeNull();
  });

  it('rebuilds a freshly created errand', () => {
    expect(foldEvents([created])).toEqual({
      id: errandId,
      status: 'Pending-Supplier',
      lastSequenceNumber: 1,
      requesterId: '33333333-3333-3333-3333-333333333333',
      supplierId: '44444444-4444-4444-4444-444444444444',
      deliveryBuildingId: '55555555-5555-5555-5555-555555555555',
      deliveryDetail: 'Level 3 04-02',
      deliveryLocation: null,
      rewardCredits: 5,
      pickupLocation: null,
      pickupName: null,
      pickupDescription: null,
      description: null,
      expiresAt: null,
      courierId: null,
      supplierValidatedAt: null,
      pickedUpAt: null,
      deliveredAt: null,
      cancellationReason: null,
    });
  });

  it('takes status and sequence number from the last event', () => {
    const out = foldEvents([created, ev(2, 'Reserving-Credit', {})]);
    expect(out).toMatchObject({ status: 'Reserving-Credit', lastSequenceNumber: 2 });
  });

  it('records when the supplier was validated', () => {
    const at = '2030-01-01T00:00:00.000Z';
    const out = foldEvents([created, ev(2, 'Reserving-Credit', { supplierValidatedAt: at })]);
    expect(out?.supplierValidatedAt).toEqual(new Date(at));
  });

  it('resets a column a later event cleared', () => {
    const out = foldEvents([
      created,
      ev(2, 'Accepted', { courierId: courier }),
      ev(3, 'Open', { courierId: null }),
    ]);
    expect(out?.courierId).toBeNull();
  });

  it('records the delivery building short name when the supplier validates', () => {
    const out = foldEvents([created, ev(2, 'Reserving-Credit', { deliveryLocation: 'COM2' })]);
    expect(out?.deliveryLocation).toBe('COM2');
  });

  it('restores ISO strings to Dates', () => {
    const out = foldEvents([
      created,
      ev(2, 'Picked Up', { pickedUpAt: '2030-01-01T00:00:00.000Z' }),
    ]);
    expect(out?.pickedUpAt).toEqual(new Date('2030-01-01T00:00:00.000Z'));
  });

  it('ignores payload keys that are not projection columns', () => {
    const out = foldEvents([created, ev(2, 'Reserving-Credit', { note: 'hi' })]);
    expect(out).not.toHaveProperty('note');
  });

  it('throws on a gap in the sequence', () => {
    expect(() => foldEvents([created, ev(3, 'Open', {})])).toThrow(/expected event 2/);
  });
});
