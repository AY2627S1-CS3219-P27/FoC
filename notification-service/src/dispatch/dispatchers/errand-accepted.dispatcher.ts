import type { ErrandAcceptedEvent } from '@foc/contracts';
import type { DispatchService } from '../dispatch.service.js';

export function dispatchErrandAccepted(
  event: ErrandAcceptedEvent,
  dispatch: DispatchService,
): Promise<void> {
  return dispatch.enqueue(event, {
    recipients: [event.payload.requesterUserId, event.payload.courierUserId],
    message: {
      title: 'Errand accepted',
      body: 'An errand has been accepted and is now in progress.',
      tag: event.eventId,
      url: '/home',
    },
  });
}
