import type {
  CourierCancelledEvent,
  ErrandAcceptedEvent,
  ErrandCancelledEvent,
  ErrandDeliveredEvent,
} from '@foc/contracts';
import type { ChatLifecycleKind } from '../database/entities/index.js';

export type LifecycleEvent =
  | ErrandAcceptedEvent
  | ErrandDeliveredEvent
  | CourierCancelledEvent
  | ErrandCancelledEvent;

export interface NormalizedLifecycleEvent {
  event: LifecycleEvent;
  kind: ChatLifecycleKind;
  errandId: string;
  requesterUserId: string | null;
  courierUserId: string | null;
  occurredAt: Date;
  derivedCloseAt: Date | null;
  envelope: Record<string, unknown>;
  payload: Record<string, unknown>;
}

const THREE_HOURS_MS = 3 * 60 * 60 * 1_000;
const THIRTY_MINUTES_MS = 30 * 60 * 1_000;

export function normalizeLifecycleEvent(
  event: LifecycleEvent,
): NormalizedLifecycleEvent {
  const occurredAt = new Date(event.timestamp);
  const envelope = {
    eventId: event.eventId,
    eventType: event.eventType,
    timestamp: event.timestamp,
    publisher: event.publisher,
  };

  switch (event.eventType) {
    case 'ErrandAccepted':
      return {
        event,
        kind: 'ERRAND_ACCEPTED',
        errandId: event.payload.errandId,
        requesterUserId: event.payload.requesterUserId,
        courierUserId: event.payload.courierUserId,
        occurredAt,
        derivedCloseAt: null,
        envelope,
        payload: { ...event.payload },
      };
    case 'ErrandDelivered':
      return {
        event,
        kind: 'ERRAND_DELIVERED',
        errandId: event.payload.errandId,
        requesterUserId: event.payload.requesterUserId,
        courierUserId: event.payload.courierUserId,
        occurredAt,
        derivedCloseAt: new Date(occurredAt.getTime() + THREE_HOURS_MS),
        envelope,
        payload: { ...event.payload },
      };
    case 'CourierCancelled':
      return {
        event,
        kind: 'COURIER_CANCELLED',
        errandId: event.payload.errandId,
        requesterUserId: event.payload.requesterUserId,
        courierUserId: event.payload.courierUserId,
        occurredAt,
        derivedCloseAt: new Date(occurredAt.getTime() + THIRTY_MINUTES_MS),
        envelope,
        payload: { ...event.payload },
      };
    case 'ErrandCancelled':
      return {
        event,
        kind: 'ERRAND_CANCELLED',
        errandId: event.payload.errandId,
        requesterUserId: null,
        courierUserId: null,
        occurredAt,
        derivedCloseAt: new Date(occurredAt.getTime() + THIRTY_MINUTES_MS),
        envelope,
        payload: { ...event.payload },
      };
  }
}

export function hasDistinctParticipants(event: LifecycleEvent): boolean {
  return (
    event.eventType === 'ErrandCancelled' ||
    event.payload.requesterUserId !== event.payload.courierUserId
  );
}
