import type {
  CourierCancelledEvent,
  ErrandAcceptedEvent,
  ErrandCancelledEvent,
  ErrandDeliveredEvent,
} from '@foc/contracts';
import { normalizeLifecycleEvent } from './lifecycle-event.js';

const participants = {
  errandId: '2062212e-3a39-4a7c-b9bb-d1e743618b61',
  requesterUserId: '21e66a66-257f-4a64-b059-46d353ec21c6',
  courierUserId: 'ea1d20b3-dc12-4498-b750-967c86d74023',
};
const timestamp = '2026-11-04T00:00:00.000Z';

function envelope<TType extends string, TPayload>(
  eventType: TType,
  payload: TPayload,
) {
  return {
    eventId: '98f5905c-2cd6-4e4c-b3d2-eaa87440af87',
    eventType,
    timestamp,
    publisher: 'order-service' as const,
    payload,
  };
}

describe('normalizeLifecycleEvent', () => {
  it.each([
    [
      envelope('ErrandAccepted', participants) as ErrandAcceptedEvent,
      'ERRAND_ACCEPTED',
      null,
    ],
    [
      envelope('ErrandDelivered', participants) as ErrandDeliveredEvent,
      'ERRAND_DELIVERED',
      '2026-11-04T03:00:00.000Z',
    ],
    [
      envelope('CourierCancelled', participants) as CourierCancelledEvent,
      'COURIER_CANCELLED',
      '2026-11-04T00:30:00.000Z',
    ],
    [
      envelope('ErrandCancelled', {
        errandId: participants.errandId,
      }) as ErrandCancelledEvent,
      'ERRAND_CANCELLED',
      '2026-11-04T00:30:00.000Z',
    ],
  ] as const)(
    'normalizes %s and derives its authoritative deadline',
    (event, kind, deadline) => {
      const normalized = normalizeLifecycleEvent(event);
      expect(normalized.kind).toBe(kind);
      expect(normalized.occurredAt.toISOString()).toBe(timestamp);
      expect(normalized.derivedCloseAt?.toISOString() ?? null).toBe(deadline);
      expect(normalized.envelope).not.toHaveProperty('payload');
      expect(normalized.payload).toEqual(event.payload);
      if (event.eventType === 'ErrandCancelled') {
        expect(normalized.requesterUserId).toBeNull();
        expect(normalized.courierUserId).toBeNull();
      }
    },
  );
});
