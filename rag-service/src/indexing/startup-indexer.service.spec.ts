import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/environment.schema.js';
import type { IndexingService } from './indexing.service.js';
import { StartupIndexerService } from './startup-indexer.service.js';

describe('StartupIndexerService', () => {
  let indexing: {
    isUpToDate: ReturnType<typeof vi.fn>;
    reindex: ReturnType<typeof vi.fn>;
  };
  let errorLog: ReturnType<typeof vi.spyOn>;

  const service = (enabled = true) =>
    new StartupIndexerService(
      { get: () => enabled } as unknown as ConfigService<
        EnvironmentVariables,
        true
      >,
      indexing as unknown as IndexingService,
    );

  beforeEach(() => {
    indexing = {
      isUpToDate: vi.fn().mockResolvedValue(false),
      reindex: vi.fn().mockResolvedValue(3),
    };
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    errorLog = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('re-indexes when the documents have changed', async () => {
    await service().bringUpToDate();

    expect(indexing.reindex).toHaveBeenCalledOnce();
  });

  it('makes no model call when the index already matches', async () => {
    indexing.isUpToDate.mockResolvedValue(true);

    await service().bringUpToDate();

    expect(indexing.reindex).not.toHaveBeenCalled();
  });

  it('logs a failed re-index instead of crashing the service', async () => {
    indexing.reindex.mockRejectedValue(new Error('OpenRouter answered 401'));

    await expect(service().bringUpToDate()).resolves.toBeUndefined();

    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining('OpenRouter answered 401'),
    );
  });

  it('logs a failed check, such as missing documents', async () => {
    indexing.isUpToDate.mockRejectedValue(new Error('no documents'));

    await expect(service().bringUpToDate()).resolves.toBeUndefined();

    expect(indexing.reindex).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalled();
  });

  it('does nothing when switched off', () => {
    service(false).onApplicationBootstrap();

    expect(indexing.isUpToDate).not.toHaveBeenCalled();
  });

  it('does not make startup wait for the outside call', () => {
    let finish!: (upToDate: boolean) => void;
    indexing.isUpToDate.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );

    // Returning at all, with the check still unfinished, is the point.
    expect(service().onApplicationBootstrap()).toBeUndefined();
    expect(indexing.isUpToDate).toHaveBeenCalledOnce();
    finish(true);
  });
});
