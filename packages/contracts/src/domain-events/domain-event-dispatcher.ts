import type {
  ContractViolation,
  EventContractFailureCode,
} from '../common/types.js';
import type { AccountEventContractValidator } from './account-event-contract.validator.js';
import type { EventEnvelope } from './event-envelope.types.js';
import type { EventContractKey, EventOf } from './event-registry.types.js';

/** Any validated domain event envelope, regardless of its concrete payload. */
export type AnyDomainEvent = EventEnvelope<string, string, object>;

/** A handler for one registered event contract. */
export type DomainEventHandler = (
  event: AnyDomainEvent,
) => void | Promise<void>;

/**
 * Handlers keyed by routing key. Omitted keys are skipped, which is the
 * intended policy for broad pub/sub bindings: a subscriber must not
 * dead-letter event types it does not implement.
 */
export type DomainEventHandlers = {
  [TKey in EventContractKey]?: (event: EventOf<TKey>) => void | Promise<void>;
};

export type DomainEventDispatchResult =
  | { outcome: 'handled' }
  | { outcome: 'skipped'; routingKey: string }
  | {
      outcome: 'invalid';
      code: EventContractFailureCode;
      violations: ContractViolation[];
    };

/**
 * Routes a received message to the handler registered for its routing key.
 * The routing key selects the contract; the contract validates the envelope
 * and payload before the typed handler sees it.
 */
export class DomainEventDispatcher {
  constructor(private readonly contracts: AccountEventContractValidator) {}

  async dispatch(
    routingKey: string,
    input: unknown,
    handlers: DomainEventHandlers,
  ): Promise<DomainEventDispatchResult> {
    const handler = handlers[routingKey as EventContractKey] as unknown as
      DomainEventHandler | undefined;
    if (handler === undefined) {
      return { outcome: 'skipped', routingKey };
    }

    const checked = this.contracts.validateReceived(routingKey, input);
    if (!checked.valid) {
      return {
        outcome: 'invalid',
        code: checked.code,
        violations: checked.violations,
      };
    }

    await handler(checked.value);
    return { outcome: 'handled' };
  }
}
