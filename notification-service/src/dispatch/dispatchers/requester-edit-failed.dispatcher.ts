import type { EditFailedReason, RequesterEditFailedEvent } from '@foc/contracts';
import type { DispatchService } from '../dispatch.service.js';

const UNDONE = 'Your changes were undone.';

// What the requester is told when an edit is refused. The errand itself is untouched.
const BODY: Record<EditFailedReason, string> = {
  NOT_FOUND: `That supplier is no longer available. ${UNDONE}`,
  INACTIVE: `That supplier is no longer available. ${UNDONE}`,
  BUILDING_NOT_FOUND: `That building is no longer available. ${UNDONE}`,
  VENUE_NOT_FOUND: `That building is no longer available. ${UNDONE}`,
  TIMEOUT: `We couldn't confirm the supplier in time. ${UNDONE}`,
  INSUFFICIENT_CREDITS: `You don't have enough credits for the new reward. ${UNDONE}`,
  RESERVATION_NOT_FOUND: `We couldn't update your reserved credits. ${UNDONE}`,
  STALE_RESERVATION_AMOUNT: `We couldn't update your reserved credits. ${UNDONE}`,
};

export function dispatchRequesterEditFailed(
  event: RequesterEditFailedEvent,
  dispatch: DispatchService,
): Promise<void> {
  return dispatch.enqueue(event, {
    recipients: [event.payload.requesterUserId],
    message: {
      title: 'Edit not saved',
      body: BODY[event.payload.reason] ?? `Your edit could not be saved. ${UNDONE}`,
      tag: event.eventId,
      url: '/home',
    },
  });
}
