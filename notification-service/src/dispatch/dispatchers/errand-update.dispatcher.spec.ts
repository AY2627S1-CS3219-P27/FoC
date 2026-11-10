import { describe, expect, it, vi } from 'vitest';
import type { ErrandUpdateEvent } from '@foc/contracts';
import type { DispatchService } from '../dispatch.service.js';
import { dispatchErrandUpdate } from './errand-update.dispatcher.js';

const R = '11111111-1111-4111-8111-111111111111';
const C = '22222222-2222-4222-8222-222222222222';
const ev = (payload: Partial<ErrandUpdateEvent['payload']>): ErrandUpdateEvent => ({
  eventId: '33333333-3333-4333-8333-333333333333',
  eventType: 'ErrandUpdate',
  timestamp: '2026-11-05T09:00:00.000Z',
  publisher: 'order-service',
  payload: {
    errandId: '44444444-4444-4444-8444-444444444444',
    requesterUserId: R,
    courierUserId: C,
    kind: 'PICKED_UP',
    ...payload,
  },
});

async function sent(e: ErrandUpdateEvent) {
  const enqueue = vi.fn().mockResolvedValue(undefined);
  await dispatchErrandUpdate(e, { enqueue } as unknown as DispatchService);
  return enqueue.mock.calls[0][1];
}

describe('dispatchErrandUpdate', () => {
  it('tells only the requester about pickup', async () => {
    expect((await sent(ev({}))).recipients).toEqual([R]);
  });
  it('tells only the courier about a system cancel and an incomplete mark', async () => {
    expect((await sent(ev({ kind: 'CANCELLED' }))).recipients).toEqual([C]);
    expect((await sent(ev({ kind: 'MARKED_INCOMPLETE' }))).recipients).toEqual([C]);
  });
  it('tells both about settlement, transfer failure and dispute resolution', async () => {
    for (const kind of ['TRANSFER_SETTLED', 'TRANSFER_FAILED', 'DISPUTE_RESOLVED'] as const)
      expect((await sent(ev({ kind }))).recipients).toEqual([R, C]);
  });
  it('includes the split and note on dispute resolution', async () => {
    const m = (await sent(ev({ kind: 'DISPUTE_RESOLVED', courierAmount: 3, requesterAmount: 2, note: 'Split' }))).message;
    expect(m.body).toContain('Courier received 3 credits, requester 2.');
    expect(m.body).toContain('Note: Split');
  });
});
