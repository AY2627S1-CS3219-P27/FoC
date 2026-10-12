import type { EventContractPayload } from './event-contract.types.js';
import type { EventEnvelope } from './event-envelope.types.js';
import type { eventRegistry } from './event-registry.js';

type EventRegistry = typeof eventRegistry;

export type EventContractKey = keyof EventRegistry;
export type EventType = EventRegistry[EventContractKey]['eventType'];

export type EventOf<TKey extends EventContractKey> = EventEnvelope<
  EventRegistry[TKey]['eventType'],
  EventRegistry[TKey]['publisher'],
  EventContractPayload<EventRegistry[TKey]>
>;

export type UserRegisteredEvent = EventOf<'user.registered.v1'>;
export type CreditAccountInitialisedEvent =
  EventOf<'credit.account-initialised.v1'>;
export type CreditReservationEvent = EventOf<'credit.reservation.v1'>;
export type CreditReservationAdjustmentEvent =
  EventOf<'credit.reservation-adjustment.v1'>;
export type CreditReservationSuccessEvent =
  EventOf<'credit.reservation-success.v1'>;
export type CreditReservationRejectedEvent =
  EventOf<'credit.reservation-rejected.v1'>;
export type CreditReservationAdjustmentSuccessEvent =
  EventOf<'credit.reservation-adjustment-success.v1'>;
export type CreditReservationAdjustmentRejectedEvent =
  EventOf<'credit.reservation-adjustment-rejected.v1'>;
