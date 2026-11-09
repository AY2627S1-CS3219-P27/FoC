import type { ErrandDeliveredEvent } from '@foc/contracts';
import type { DispatchService } from '../dispatch.service.js';

export function dispatchErrandDelivered(
  event: ErrandDeliveredEvent,
  dispatch: DispatchService,
): Promise<void> {
  return dispatch.enqueue(event, {
    recipients: [event.payload.requesterUserId],
    message: {
      title: "It's Here!",
      body: 'Your errand item(s) have been delivered.',
      tag: event.eventId,
      url: '/home',
    },
  });
}
