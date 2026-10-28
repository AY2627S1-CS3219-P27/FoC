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
export type ErrandCompletedEvent = EventOf<'order.errand-completed.v1'>;
export type ErrandCancelledEvent = EventOf<'order.errand-cancelled.v1'>;
export type CreditTransferSucceededEvent =
  EventOf<'credit.transfer-succeeded.v1'>;
export type CreditTransferRejectedEvent =
  EventOf<'credit.transfer-rejected.v1'>;
export type CreditReleaseSuccessEvent = EventOf<'credit.release-success.v1'>;
export type CreditReleaseRejectedEvent = EventOf<'credit.release-rejected.v1'>;
export type CreditSettlementEvent = EventOf<'credit.settlement.v1'>;
export type CreditSettlementSucceededEvent =
  EventOf<'credit.settlement-succeeded.v1'>;
export type CreditSettlementRejectedEvent =
  EventOf<'credit.settlement-rejected.v1'>;
export type SupplierValidationRequestedEvent =
  EventOf<'order.supplier-validation-requested.v1'>;
export type SupplierValidationCompletedEvent =
  EventOf<'supplier.validation-completed.v1'>;
