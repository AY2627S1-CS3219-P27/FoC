import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/environment.schema.js';
import { ChatLogCleanupService } from './chat-log-cleanup.service.js';
import type { ChatLogRepository } from './chat-log.repository.js';

describe('ChatLogCleanupService', () => {
  let deleteOlderThan: ReturnType<typeof vi.fn>;
  let service: ChatLogCleanupService;
  let errorLog: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    errorLog = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    deleteOlderThan = vi.fn().mockResolvedValue(0);
    service = new ChatLogCleanupService(
      { deleteOlderThan } as unknown as ChatLogRepository,
      { get: () => 30 } as unknown as ConfigService<EnvironmentVariables, true>,
    );
  });

  afterEach(() => {
    service.onApplicationShutdown();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('cleans up at startup with the retention setting', () => {
    service.onApplicationBootstrap();

    expect(deleteOlderThan).toHaveBeenCalledWith(30);
  });

  it('cleans up again each day', () => {
    service.onApplicationBootstrap();
    vi.advanceTimersByTime(2 * 24 * 60 * 60 * 1000);

    expect(deleteOlderThan).toHaveBeenCalledTimes(3);
  });

  it('stops at shutdown', () => {
    service.onApplicationBootstrap();
    service.onApplicationShutdown();
    vi.advanceTimersByTime(2 * 24 * 60 * 60 * 1000);

    expect(deleteOlderThan).toHaveBeenCalledOnce();
  });

  it('logs a failure instead of crashing the service', async () => {
    deleteOlderThan.mockRejectedValue(new Error('database gone'));

    await expect(service.deleteOldRows()).resolves.toBeUndefined();

    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining('database gone'),
    );
  });
});
