import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/environment.js';
import type { ChatRealtimePublisher } from '../socket/chat-realtime.publisher.js';
import type { ArchiveClaimService } from './archive-claim.service.js';
import type { ArchiveService } from './archive.service.js';
import { ArchiveWorker } from './archive.worker.js';

const claim = {
  chatId: '11111111-1111-4111-8111-111111111111',
  claimToken: '22222222-2222-4222-8222-222222222222',
  reclaimed: false,
};
const notification = {
  chatId: claim.chatId,
  archiveId: '33333333-3333-4333-8333-333333333333',
  requesterUserId: '44444444-4444-4444-8444-444444444444',
  courierUserId: '55555555-5555-4555-8555-555555555555',
  archivedAt: new Date('2026-11-06T10:00:00.000Z'),
};

function harness() {
  const claimDueBatch = vi.fn().mockResolvedValue([claim]);
  const archive = vi.fn().mockResolvedValue({
    status: 'archived',
    notification,
  });
  const publishArchived = vi.fn();
  const worker = new ArchiveWorker(
    {
      get: vi.fn().mockReturnValue(5_000),
    } as unknown as ConfigService<EnvironmentVariables, true>,
    { claimDueBatch } as unknown as ArchiveClaimService,
    { archive } as unknown as ArchiveService,
    { publishArchived } as unknown as ChatRealtimePublisher,
  );
  return { archive, claimDueBatch, publishArchived, worker };
}

describe('ArchiveWorker', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('publishes only after an archive transaction resolves', async () => {
    const { archive, publishArchived, worker } = harness();

    await worker.runOnce();

    expect(publishArchived).toHaveBeenCalledWith(notification);
    expect(archive.mock.invocationCallOrder[0]).toBeLessThan(
      publishArchived.mock.invocationCallOrder[0]!,
    );
  });

  it('continues a batch after a failed or stale claim', async () => {
    const { archive, claimDueBatch, publishArchived, worker } = harness();
    const second = { ...claim, chatId: notification.archiveId };
    const third = { ...claim, chatId: notification.requesterUserId };
    claimDueBatch.mockResolvedValue([claim, second, third]);
    archive
      .mockRejectedValueOnce(new Error('injected archive failure'))
      .mockResolvedValueOnce({ status: 'stale' })
      .mockResolvedValueOnce({ status: 'archived', notification });

    await expect(worker.runOnce()).resolves.toBeUndefined();

    expect(archive).toHaveBeenCalledTimes(3);
    expect(publishArchived).toHaveBeenCalledOnce();
  });

  it('stops scheduling and drains bounded in-flight work during shutdown', async () => {
    vi.useFakeTimers();
    const { archive, claimDueBatch, worker } = harness();
    let resolveArchive!: (value: { status: 'stale' }) => void;
    archive.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveArchive = resolve;
      }),
    );

    worker.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);
    const shutdown = worker.beforeApplicationShutdown();
    let drained = false;
    void shutdown.then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);

    resolveArchive({ status: 'stale' });
    await shutdown;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(claimDueBatch).toHaveBeenCalledOnce();
  });
});
