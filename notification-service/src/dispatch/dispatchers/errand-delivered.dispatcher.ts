import type { ErrandDeliveredEvent } from '@foc/contracts';
import type { DispatchService } from '../dispatch.service.js';

export function dispatchErrandDelivered(
  event: ErrandDeliveredEvent,
  dispatch: DispatchService,
): Promise<void> {
  return dispatch.enqueue(event, {
    recipients: [event.payload.requesterUserId, event.payload.courierUserId],
    message: {
      title: 'Errand delivered',
      body: 'Your errand has been delivered.',
      tag: event.eventId,
      url: '/home',
    },
  });
}
