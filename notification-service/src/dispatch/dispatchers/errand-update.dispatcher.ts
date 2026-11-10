import type { ErrandUpdateEvent, ErrandUpdateKind } from '@foc/contracts';
import type { DispatchService } from '../dispatch.service.js';

type Who = 'requester' | 'courier' | 'both';
const COPY: Record<ErrandUpdateKind, { who: Who; title: string; body: string }> = {
  PICKED_UP: { who: 'requester', title: 'Order picked up', body: 'Your courier has picked up your order.' },
  CANCELLED: {
    who: 'courier',
    title: 'Errand cancelled',
    body: "The errand wasn't delivered in time and was cancelled.",
  },
  MARKED_INCOMPLETE: {
    who: 'courier',
    title: 'Delivery disputed',
    body: 'The requester marked this delivery incomplete. An admin will review it.',
  },
  TRANSFER_SETTLED: {
    who: 'both',
    title: 'Errand complete',
    body: 'Your errand is complete. Credits have been settled.',
  },
  TRANSFER_FAILED: {
    who: 'both',
    title: 'Credit transfer failed',
    body: "We couldn't transfer the credits. An admin will review the errand.",
  },
  DISPUTE_RESOLVED: { who: 'both', title: 'Dispute resolved', body: 'An admin resolved the dispute.' },
};

export function dispatchErrandUpdate(
  event: ErrandUpdateEvent,
  dispatch: DispatchService,
): Promise<void> {
  const { requesterUserId, courierUserId, kind, courierAmount, requesterAmount, note } =
    event.payload;
  const c = COPY[kind];
  const recipients =
    c.who === 'both' ? [requesterUserId, courierUserId] : [c.who === 'requester' ? requesterUserId : courierUserId];
  let body = c.body;
  if (kind === 'DISPUTE_RESOLVED') {
    body += ` Courier received ${courierAmount} credits, requester ${requesterAmount}.`;
    if (note) body += ` Note: ${note}`;
  }
  return dispatch.enqueue(event, {
    recipients,
    message: { title: c.title, body, tag: event.eventId, url: '/home' },
  });
}
