import { describe, expect, it, vi } from 'vitest';
import type { RequesterErrandCancelledEvent } from '@foc/contracts';
import type { DispatchService } from '../dispatch.service.js';
import { dispatchRequesterErrandCancelled } from './requester-errand-cancelled.dispatcher.js';

const REQUESTER = '11111111-1111-4111-8111-111111111111';

const event = (cancellationReason: string): RequesterErrandCancelledEvent => ({
  eventId: '33333333-3333-4333-8333-333333333333',
  eventType: 'RequesterErrandCancelled',
  timestamp: '2026-11-05T09:00:00.000Z',
  publisher: 'order-service',
  payload: {
    errandId: '44444444-4444-4444-8444-444444444444',
    requesterUserId: REQUESTER,
    cancellationReason: cancellationReason as RequesterErrandCancelledEvent['payload']['cancellationReason'],
  },
});

describe('dispatchRequesterErrandCancelled', () => {
  it('tells only the requester, and that they can resubmit after CREDIT_TIMEOUT', async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    await dispatchRequesterErrandCancelled(event('CREDIT_TIMEOUT'), {
      enqueue,
    } as unknown as DispatchService);

    const [, { recipients, message }] = enqueue.mock.calls[0];
    expect(recipients).toEqual([REQUESTER]);
    expect(message.body).toContain('resubmit');
  });

  it('falls back to generic copy for an unknown reason', async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    await dispatchRequesterErrandCancelled(event('SOMETHING_NEW'), {
      enqueue,
    } as unknown as DispatchService);

    expect(enqueue.mock.calls[0][1].message.body).toBe('Your errand was cancelled.');
  });
});
