import { describe, expect, it, vi } from 'vitest';
import type { RequesterEditFailedEvent } from '@foc/contracts';
import type { DispatchService } from '../dispatch.service.js';
import { dispatchRequesterEditFailed } from './requester-edit-failed.dispatcher.js';

const REQUESTER = '11111111-1111-4111-8111-111111111111';

const event = (step: string, reason: string): RequesterEditFailedEvent => ({
  eventId: '33333333-3333-4333-8333-333333333333',
  eventType: 'RequesterEditFailed',
  timestamp: '2026-11-10T09:00:00.000Z',
  publisher: 'order-service',
  payload: {
    errandId: '44444444-4444-4444-8444-444444444444',
    requesterUserId: REQUESTER,
    step: step as RequesterEditFailedEvent['payload']['step'],
    reason: reason as RequesterEditFailedEvent['payload']['reason'],
  },
});

const send = async (e: RequesterEditFailedEvent) => {
  const enqueue = vi.fn().mockResolvedValue(undefined);
  await dispatchRequesterEditFailed(e, { enqueue } as unknown as DispatchService);
  return enqueue.mock.calls[0][1];
};

describe('dispatchRequesterEditFailed', () => {
  it('tells only the requester, and that the changes were undone', async () => {
    const { recipients, message } = await send(event('supplier', 'INACTIVE'));
    expect(recipients).toEqual([REQUESTER]);
    expect(message.body).toContain('undone');
  });

  it('names the credits when credit refused', async () => {
    expect((await send(event('credit', 'INSUFFICIENT_CREDITS'))).message.body).toContain('enough credits');
  });

  it('falls back to generic copy for an unknown reason', async () => {
    expect((await send(event('supplier', 'SOMETHING_NEW'))).message.body).toContain('could not be saved');
  });
});
