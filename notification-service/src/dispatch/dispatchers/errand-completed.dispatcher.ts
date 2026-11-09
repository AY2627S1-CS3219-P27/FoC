import type { ErrandCompletedEvent } from '@foc/contracts';
import type { DispatchService } from '../dispatch.service.js';

export function dispatchErrandCompleted(
  event: ErrandCompletedEvent,
  dispatch: DispatchService,
): Promise<void> {
  return dispatch.enqueue(event, {
    recipients: [event.payload.requesterUserId, event.payload.courierUserId],
    message: {
      title: 'Errand complete',
      body: 'Your errand is complete. Credits have been settled.',
      tag: event.eventId,
      url: '/home',
    },
  });
}
