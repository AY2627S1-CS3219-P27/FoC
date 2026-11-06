import type { DataSource } from 'typeorm';
import { ChatAdmissionService } from './chat-admission.service.js';

const userId = '11111111-1111-4111-8111-111111111111';
const chatId = '22222222-2222-4222-8222-222222222222';

describe('ChatAdmissionService', () => {
  const query = vi.fn();
  const service = new ChatAdmissionService({ query } as unknown as DataSource);

  beforeEach(() => vi.clearAllMocks());

  it('returns authorized live chat metadata and latest committed sequence', async () => {
    query.mockResolvedValueOnce([
      {
        chat_id: chatId,
        state: 'GRACE',
        closes_at: new Date('2026-11-04T10:00:00.000Z'),
        close_reason: 'ERRAND_DELIVERED',
        next_sequence: '4',
      },
    ]);

    await expect(service.authorize(userId, chatId)).resolves.toEqual({
      chatId,
      state: 'GRACE',
      closesAt: '2026-11-04T10:00:00.000Z',
      closeReason: 'ERRAND_DELIVERED',
      latestSequence: 3,
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('c.state IN'), [
      chatId,
      userId,
    ]);
  });

  it('conceals absent, archived, and unauthorized chats as not found', async () => {
    query.mockResolvedValueOnce([]);

    await expect(service.authorize(userId, chatId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Chat not found',
    });
  });

  it('fails closed when the sequence exceeds the protocol range', async () => {
    query.mockResolvedValueOnce([
      {
        chat_id: chatId,
        state: 'ACTIVE',
        closes_at: null,
        close_reason: null,
        next_sequence: '9007199254740992',
      },
    ]);

    await expect(service.authorize(userId, chatId)).rejects.toThrow(
      'Chat sequence exceeds the supported protocol range',
    );
  });
});
