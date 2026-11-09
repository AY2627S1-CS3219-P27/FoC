import type { CourierCancelledEvent } from '@foc/contracts';
import type { DispatchService } from '../dispatch.service.js';

export function dispatchCourierCancelled(
  event: CourierCancelledEvent,
  dispatch: DispatchService,
): Promise<void> {
  return dispatch.enqueue(event, {
    recipients: [event.payload.requesterUserId],
    message: {
      title: 'Courier cancelled',
      body: 'The courier cancelled the errand.',
      tag: event.eventId,
      url: '/home',
    },
  });
}
