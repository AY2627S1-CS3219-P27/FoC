import type {
  RequesterErrandCancelledEvent,
  SystemCancellationReason,
} from '@foc/contracts';
import type { DispatchService } from '../dispatch.service.js';

// What the requester is told for each system cancellation reason. Keep in step
// with the frontend's cancellation copy (frontend/app/home/_errands/cancellation.ts).
const BODY: Record<SystemCancellationReason, string> = {
  SUPPLIER_VALIDATION_TIMEOUT:
    "We couldn't confirm the supplier in time. You can resubmit your errand.",
  CREDIT_TIMEOUT:
    "We couldn't reserve your credits in time. You can resubmit your errand.",
  SUPPLIER_UNAVAILABLE:
    'That supplier is no longer available. Resubmit with another one.',
  BUILDING_UNAVAILABLE:
    'That building is no longer available. Resubmit with another one.',
  INSUFFICIENT_CREDITS:
    "You didn't have enough credits. Top up, then resubmit your errand.",
  MISSING_BALANCE:
    "You didn't have enough credits. Top up, then resubmit your errand.",
  ERRAND_EXPIRED:
    'No courier accepted it in time. You can resubmit it with a longer expiry.',
  PICKUP_TIME_EXCEEDED:
    "It wasn't delivered in time and your credits were released. You can resubmit it.",
};

export function dispatchRequesterErrandCancelled(
  event: RequesterErrandCancelledEvent,
  dispatch: DispatchService,
): Promise<void> {
  return dispatch.enqueue(event, {
    recipients: [event.payload.requesterUserId],
    message: {
      title: 'Errand cancelled',
      body: BODY[event.payload.cancellationReason] ?? 'Your errand was cancelled.',
      tag: event.eventId,
      url: '/home',
    },
  });
}
