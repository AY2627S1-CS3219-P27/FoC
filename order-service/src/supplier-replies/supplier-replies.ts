import type { EventOf } from '@foc/contracts';
import { deliveryLabel } from '../campus/delivery-label.js';
import { reply, type ReplySpec } from '../credit-replies/credit-reply.handler.js';
import type { ReplyErrand } from '../lifecycle/lifecycle.service.js';

// ADR 0009: the errand keeps the pickup as validated; later supplier edits do not change it.
export const pickupOf = (s: { displayName: string; building: { shortName: string }; floor: string; locationDescription: string }) => ({
  pickupName: s.displayName,
  pickupLocation: s.building.shortName,
  pickupDescription: [s.floor && `Floor ${s.floor}`, s.locationDescription].filter(Boolean).join(' · '),
});

type Completed = EventOf<'supplier.validation-completed.v1'>;

// F2: the answer to an edit's re-check. The reply carries no request id, so one
// about another supplier or building is a stale answer to an earlier request.
function revalidation(e: Completed, errand: ReplyErrand) {
  const p = e.payload;
  const found = p.outcome === 'FOUND';
  if (
    p.supplierId.toLowerCase() !== errand.supplierId.toLowerCase() ||
    (found && p.deliveryBuilding.id.toLowerCase() !== errand.deliveryBuildingId.toLowerCase())
  ) {
    return { ignore: `stale reply for errand ${p.errandId}: not the pending supplier and building` };
  }
  const base = { errandId: p.errandId, expected: 'Revalidating-Supplier', to: 'Open' } as const;
  if (found && p.supplier.status === 'Active') {
    return {
      ...base,
      type: 'SupplierRevalidated',
      set: {
        supplierId: p.supplierId,
        deliveryBuildingId: p.deliveryBuilding.id,
        supplierValidatedAt: new Date(e.timestamp),
        ...pickupOf(p.supplier),
        deliveryLocation: p.deliveryBuilding.shortName,
      },
      payload: { supplierEventId: e.eventId, supplier: p.supplier },
    };
  }
  // The old supplier stays; nothing is cancelled.
  return {
    ...base,
    type: 'SupplierRevalidationFailed',
    payload: { supplierEventId: e.eventId, supplierOutcome: found ? 'INACTIVE' : p.outcome },
  };
}

export const SUPPLIER_REPLY_SPECS: ReplySpec[] = [
  {
    ...reply('supplier.validation-completed.v1', async (e, pinOf, errand) => {
      if (errand?.status === 'Revalidating-Supplier') return revalidation(e, errand);
      const p = e.payload;
      // Validation is settled; a redelivery would pick a different edge than it first took.
      if (errand && errand.status !== 'Pending-Supplier') {
        return { ignore: `late reply for errand ${p.errandId}, now ${errand.status}` };
      }
      if (p.outcome === 'FOUND' && p.supplier.status === 'Active') {
        // A pin was stored at creation and keeps its point and label; else the venue, else the building.
        const pin = await pinOf(p.errandId);
        const { deliveryBuilding: b, deliveryVenue: v } = p;
        const point = pin ?? v?.coordinates ?? b.coordinates;
        return {
          errandId: p.errandId,
          supplierId: p.supplierId,
          expected: 'Pending-Supplier',
          to: 'Reserving-Credit',
          set: {
            supplierValidatedAt: new Date(e.timestamp),
            ...pickupOf(p.supplier),
            deliveryLocation: b.shortName,
            deliveryVenue: deliveryLabel({ buildingShortName: b.shortName, pin: !!pin, venue: v }),
            deliveryLatitude: point.latitude,
            deliveryLongitude: point.longitude,
          }, // supplier's time, stable on redelivery
          payload: { supplierEventId: e.eventId, supplier: p.supplier },
        };
      }
      // Nothing reserved yet, so no release.
      return {
        errandId: p.errandId,
        supplierId: p.supplierId,
        expected: 'Pending-Supplier',
        to: 'Cancelled',
        set: {
          cancellationReason:
            p.outcome === 'BUILDING_NOT_FOUND'
              ? 'BUILDING_UNAVAILABLE'
              : p.outcome === 'VENUE_NOT_FOUND'
                ? 'VENUE_UNAVAILABLE'
                : 'SUPPLIER_UNAVAILABLE',
        },
        payload: {
          supplierEventId: e.eventId,
          supplierOutcome: p.outcome === 'FOUND' ? 'INACTIVE' : p.outcome,
        },
      };
    }),
    withErrand: true,
  },
];
