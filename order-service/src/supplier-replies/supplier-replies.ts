import { reply, type ReplySpec } from '../credit-replies/credit-reply.handler.js';

// Supplier Service's answer to the validation request createErrand() sends
// (supplier ADR 0002). It reports facts; what they mean is decided here.
export const SUPPLIER_REPLY_SPECS: ReplySpec[] = [
  reply('supplier.validation-completed.v1', (e) => {
    const p = e.payload;
    // F1.4.3: an Active supplier moves the errand on. The time is the
    // supplier's, so a redelivered reply carries the same value (F1.4.5).
    if (p.outcome === 'FOUND' && p.supplier.status === 'Active') {
      return {
        errandId: p.errandId,
        expected: 'Pending-Supplier',
        to: 'Reserving-Credit',
        set: { supplierValidatedAt: new Date(e.timestamp) },
        payload: { supplierEventId: e.eventId, supplier: p.supplier },
      };
    }
    // F1.4.4: missing or Inactive fails terminally. Nothing is reserved yet,
    // so there is nothing to release.
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
