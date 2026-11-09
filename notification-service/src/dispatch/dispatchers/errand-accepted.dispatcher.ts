import type { ErrandAcceptedEvent } from '@foc/contracts';
import type { DispatchService } from '../dispatch.service.js';

export function dispatchErrandAccepted(
  event: ErrandAcceptedEvent,
  dispatch: DispatchService,
): Promise<void> {
  return dispatch.enqueue(event, {
    recipients: [event.payload.requesterUserId],
    message: {
      title: 'Hang Tight!',
      body: 'Your errand has been accepted and is now in progress.',
      tag: event.eventId,
      url: '/home',
    },
  });
}
