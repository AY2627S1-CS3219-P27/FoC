import type { Namespace } from 'socket.io';
import { commsMetrics } from '../observability/comms-metrics.js';
import { ChatRealtimePublisher, roomName } from './chat-realtime.publisher.js';

const chatId = '11111111-1111-4111-8111-111111111111';
const requesterUserId = '22222222-2222-4222-8222-222222222222';
const courierUserId = '33333333-3333-4333-8333-333333333333';

describe('ChatRealtimePublisher', () => {
  const emit = vi.fn();
  const to = vi.fn(() => ({ emit }));
  let publisher: ChatRealtimePublisher;

  beforeEach(() => {
    vi.clearAllMocks();
    publisher = new ChatRealtimePublisher();
    publisher.bindNamespace({ to } as unknown as Namespace);
  });

  afterEach(() => vi.restoreAllMocks());

  it('publishes a closing transition to both participant rooms', () => {
    publisher.publishClosing({
      chatId,
      requesterUserId,
      courierUserId,
      closesAt: new Date('2026-11-06T10:00:00.000Z'),
      closeReason: 'ERRAND_DELIVERED',
    });

    expect(to).toHaveBeenCalledWith([
      roomName(chatId, requesterUserId),
      roomName(chatId, courierUserId),
    ]);
    expect(emit).toHaveBeenCalledWith('chat:closing', {
      chatId,
      closesAt: '2026-11-06T10:00:00.000Z',
      closeReason: 'ERRAND_DELIVERED',
    });
  });

  it('publishes an archive transition using the reserved typed event', () => {
    publisher.publishArchived({
      chatId,
      archiveId: '44444444-4444-4444-8444-444444444444',
      requesterUserId,
      courierUserId,
      archivedAt: new Date('2026-11-06T10:30:00.000Z'),
    });

    expect(emit).toHaveBeenCalledWith('chat:archived', {
      chatId,
      archiveId: '44444444-4444-4444-8444-444444444444',
      archivedAt: '2026-11-06T10:30:00.000Z',
    });
  });

  it('contains namespace and adapter emission failures without throwing', () => {
    const metric = vi.spyOn(commsMetrics, 'socketNotification');
    emit.mockImplementationOnce(() => {
      throw new Error('adapter unavailable');
    });

    expect(() =>
      publisher.publishClosing({
        chatId,
        requesterUserId,
        courierUserId,
        closesAt: new Date('2026-11-06T10:00:00.000Z'),
        closeReason: 'ERRAND_DELIVERED',
      }),
    ).not.toThrow();
    expect(metric).toHaveBeenCalledWith('closing', 'failed');

    const unbound = new ChatRealtimePublisher();
    expect(() =>
      unbound.publishArchived({
        chatId,
        archiveId: '44444444-4444-4444-8444-444444444444',
        requesterUserId,
        courierUserId,
        archivedAt: new Date('2026-11-06T10:30:00.000Z'),
      }),
    ).not.toThrow();
    expect(metric).toHaveBeenCalledWith('archived', 'failed');
  });
});
