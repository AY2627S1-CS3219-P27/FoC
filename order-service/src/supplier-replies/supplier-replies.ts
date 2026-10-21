import { reply, type ReplySpec } from '../credit-replies/credit-reply.handler.js';

// ADR 0009: the errand keeps the pickup as validated; later supplier edits do not change it.
export const pickupOf = (s: { displayName: string; building: { shortName: string }; floor: string; locationDescription: string }) => ({
  pickupName: s.displayName,
  pickupLocation: s.building.shortName,
  pickupDescription: [s.floor && `Floor ${s.floor}`, s.locationDescription].filter(Boolean).join(' · '),
});

export const SUPPLIER_REPLY_SPECS: ReplySpec[] = [
  reply('supplier.validation-completed.v1', (e) => {
    const p = e.payload;
    if (p.outcome === 'FOUND' && p.supplier.status === 'Active') {
      return {
        errandId: p.errandId,
        supplierId: p.supplierId,
        expected: 'Pending-Supplier',
        to: 'Reserving-Credit',
        set: { supplierValidatedAt: new Date(e.timestamp), ...pickupOf(p.supplier) }, // supplier's time, stable on redelivery
        payload: { supplierEventId: e.eventId, supplier: p.supplier },
      };
    }
    // Nothing reserved yet, so no release.
    return {
      errandId: p.errandId,
      supplierId: p.supplierId,
      expected: 'Pending-Supplier',
      to: 'Cancelled',
      set: { cancellationReason: 'SUPPLIER_UNAVAILABLE' },
      payload: {
        supplierEventId: e.eventId,
        supplierOutcome: p.outcome === 'NOT_FOUND' ? 'NOT_FOUND' : 'INACTIVE',
      },
    };
  }),
];
