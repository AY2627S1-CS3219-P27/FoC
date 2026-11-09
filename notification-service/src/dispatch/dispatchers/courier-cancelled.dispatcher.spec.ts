import { describe, expect, it, vi } from 'vitest';
import type { CourierCancelledEvent } from '@foc/contracts';
import type { DispatchService } from '../dispatch.service.js';
import { dispatchCourierCancelled } from './courier-cancelled.dispatcher.js';

const REQUESTER = '11111111-1111-4111-8111-111111111111';
const COURIER = '22222222-2222-4222-8222-222222222222';

const event: CourierCancelledEvent = {
  eventId: '33333333-3333-4333-8333-333333333333',
  eventType: 'CourierCancelled',
  timestamp: '2026-11-05T09:00:00.000Z',
  publisher: 'order-service',
  payload: {
    errandId: '44444444-4444-4444-8444-444444444444',
    requesterUserId: REQUESTER,
    courierUserId: COURIER,
  },
};

describe('dispatchCourierCancelled', () => {
  it('enqueues a push for both participants with cancellation copy', async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const dispatch = { enqueue } as unknown as DispatchService;

    await dispatchCourierCancelled(event, dispatch);

    expect(enqueue).toHaveBeenCalledWith(event, {
      recipients: [REQUESTER, COURIER],
      message: {
        title: 'Courier cancelled',
        body: 'The courier cancelled the errand.',
        tag: event.eventId,
        url: '/home',
      },
    });
  });
});
