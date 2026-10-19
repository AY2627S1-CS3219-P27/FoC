import { reply, type ReplySpec } from '../credit-replies/credit-reply.handler.js';

export const SUPPLIER_REPLY_SPECS: ReplySpec[] = [
  reply('supplier.validation-completed.v1', (e) => {
    const p = e.payload;
    if (p.outcome === 'FOUND' && p.supplier.status === 'Active') {
      return {
        errandId: p.errandId,
        expected: 'Pending-Supplier',
        to: 'Reserving-Credit',
        set: { supplierValidatedAt: new Date(e.timestamp) }, // supplier's time, stable on redelivery
        payload: { supplierEventId: e.eventId, supplier: p.supplier },
      };
    }
    // Nothing reserved yet, so no release.
    return {
      errandId: p.errandId,
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
