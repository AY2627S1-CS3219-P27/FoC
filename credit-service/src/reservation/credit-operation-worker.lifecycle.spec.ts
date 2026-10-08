import type { CreditOperationWorker } from './credit-operation.worker.js';
import { CreditOperationWorkerLifecycle } from './credit-operation-worker.lifecycle.js';

describe('CreditOperationWorkerLifecycle', () => {
  it('starts and closes the worker with the application lifecycle', async () => {
    const worker = {
      start: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const lifecycle = new CreditOperationWorkerLifecycle(
      worker as unknown as CreditOperationWorker,
    );

    await lifecycle.onApplicationBootstrap();
    await lifecycle.onApplicationShutdown();

    expect(worker.start).toHaveBeenCalledOnce();
    expect(worker.close).toHaveBeenCalledOnce();
  });
});
