import { deliveryLabel } from '../campus/delivery-label.js';
import { reply, type ReplySpec } from '../credit-replies/credit-reply.handler.js';

// ADR 0009: the errand keeps the pickup as validated; later supplier edits do not change it.
export const pickupOf = (s: { displayName: string; building: { shortName: string }; floor: string; locationDescription: string }) => ({
  pickupName: s.displayName,
  pickupLocation: s.building.shortName,
  pickupDescription: [s.floor && `Floor ${s.floor}`, s.locationDescription].filter(Boolean).join(' · '),
});

export const SUPPLIER_REPLY_SPECS: ReplySpec[] = [
  reply('supplier.validation-completed.v1', async (e, pinOf) => {
    const p = e.payload;
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
];
