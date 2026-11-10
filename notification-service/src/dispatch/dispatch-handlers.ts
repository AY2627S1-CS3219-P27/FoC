import {
  ORDER_COURIER_CANCELLED_V1_ROUTING_KEY,
  ORDER_ERRAND_ACCEPTED_V1_ROUTING_KEY,
  ORDER_ERRAND_DELIVERED_V1_ROUTING_KEY,
  ORDER_ERRAND_UPDATE_V1_ROUTING_KEY,
  ORDER_REQUESTER_EDIT_FAILED_V1_ROUTING_KEY,
  ORDER_REQUESTER_ERRAND_CANCELLED_V1_ROUTING_KEY,
  type DomainEventHandlers,
} from '@foc/contracts';
import type { DispatchService } from './dispatch.service.js';
import { dispatchCourierCancelled } from './dispatchers/courier-cancelled.dispatcher.js';
import { dispatchErrandAccepted } from './dispatchers/errand-accepted.dispatcher.js';
import { dispatchErrandDelivered } from './dispatchers/errand-delivered.dispatcher.js';
import { dispatchErrandUpdate } from './dispatchers/errand-update.dispatcher.js';
import { dispatchRequesterEditFailed } from './dispatchers/requester-edit-failed.dispatcher.js';
import { dispatchRequesterErrandCancelled } from './dispatchers/requester-errand-cancelled.dispatcher.js';

/**
 * Wires each pushable contract to its dispatcher. The contract's routing-key
 * constant selects the handler and its payload type, so a dispatcher that
 * drifts from its contract fails to compile instead of silently skipping.
 *
 * Contracts without an entry here are still validated and recorded by the
 * inbox, but fan out to nobody — expected for order events the `order.#`
 * binding admits before a dispatcher exists.
 */
export function createDispatchHandlers(
  dispatch: DispatchService,
): DomainEventHandlers {
  return {
    [ORDER_ERRAND_ACCEPTED_V1_ROUTING_KEY]: (event) =>
      dispatchErrandAccepted(event, dispatch),
    [ORDER_ERRAND_DELIVERED_V1_ROUTING_KEY]: (event) =>
      dispatchErrandDelivered(event, dispatch),
    // order.errand-completed.v1 is credit's transfer request; the "settled" push comes from the update on CreditTransferSucceeded.
    [ORDER_ERRAND_UPDATE_V1_ROUTING_KEY]: (event) =>
      dispatchErrandUpdate(event, dispatch),
    [ORDER_COURIER_CANCELLED_V1_ROUTING_KEY]: (event) =>
      dispatchCourierCancelled(event, dispatch),
    [ORDER_REQUESTER_ERRAND_CANCELLED_V1_ROUTING_KEY]: (event) =>
      dispatchRequesterErrandCancelled(event, dispatch),
    [ORDER_REQUESTER_EDIT_FAILED_V1_ROUTING_KEY]: (event) =>
      dispatchRequesterEditFailed(event, dispatch),
  };
}
