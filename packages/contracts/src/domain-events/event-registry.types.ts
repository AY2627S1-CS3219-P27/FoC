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
