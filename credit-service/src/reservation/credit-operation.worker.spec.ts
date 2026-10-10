import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import type { EnvironmentVariables } from '../config/environment.js';
import type { AdjustmentOperationProcessor } from './adjustment-operation.processor.js';
import {
  CreditOperationWorker,
  creditOperationRetryDelay,
} from './credit-operation.worker.js';
import type { CreditOperationStore } from './credit-operation.store.js';
import type { ReservationOperationProcessor } from './reservation-operation.processor.js';

function configuration() {
  const values: Pick<
    EnvironmentVariables,
    | 'CREDIT_OPERATION_POLL_INTERVAL_MS'
    | 'CREDIT_OPERATION_CLAIM_LEASE_MS'
    | 'CREDIT_OPERATION_MAX_BACKOFF_MS'
    | 'CREDIT_OPERATION_STUCK_AFTER_MS'
  > = {
    CREDIT_OPERATION_POLL_INTERVAL_MS: 1_000,
    CREDIT_OPERATION_CLAIM_LEASE_MS: 30_000,
    CREDIT_OPERATION_MAX_BACKOFF_MS: 60_000,
    CREDIT_OPERATION_STUCK_AFTER_MS: 60_000,
  };
  return {
    getOrThrow: vi.fn((key: keyof typeof values) => values[key]),
  } as unknown as ConfigService<EnvironmentVariables, true>;
}

describe('CreditOperationWorker', () => {
  it('calculates capped exponential backoff without a terminal attempt', () => {
    expect(creditOperationRetryDelay(1, 1_000, 60_000)).toBe(1_000);
    expect(creditOperationRetryDelay(2, 1_000, 60_000)).toBe(2_000);
    expect(creditOperationRetryDelay(7, 1_000, 60_000)).toBe(60_000);
    expect(creditOperationRetryDelay(100, 1_000, 60_000)).toBe(60_000);
  });

  it('claims and processes up to ten operations', async () => {
    const operation = {
      id: '96ea8eb4-6c4a-40c8-a2a5-d673fba42033',
      operationType: 'RESERVE' as const,
      createdAt: new Date(),
      attemptCount: 1,
      lastError: null,
    };
    const store = {
      claim: vi.fn().mockResolvedValue([operation]),
      markFailed: vi.fn(),
    };
    const processor = { processClaimed: vi.fn().mockResolvedValue({}) };
    const worker = new CreditOperationWorker(
      configuration(),
      store as unknown as CreditOperationStore,
      processor as unknown as ReservationOperationProcessor,
      { processClaimed: vi.fn() } as unknown as AdjustmentOperationProcessor,
    );

    await worker.runOnce();

    expect(store.claim).toHaveBeenCalledWith(expect.any(String), 10, 30_000);
    expect(processor.processClaimed).toHaveBeenCalledWith(
      operation.id,
      expect.any(String),
    );
    expect(store.markFailed).not.toHaveBeenCalled();
  });

  it('records sanitized retry metadata after a transient processing failure', async () => {
    const operation = {
      id: '96ea8eb4-6c4a-40c8-a2a5-d673fba42033',
      operationType: 'ADJUST' as const,
      createdAt: new Date(),
      attemptCount: 3,
      lastError: null,
    };
    const store = {
      claim: vi.fn().mockResolvedValue([operation]),
      markFailed: vi.fn().mockResolvedValue(true),
    };
    const processor = {
      processClaimed: vi.fn().mockRejectedValue(new Error('secret details')),
    };
    const worker = new CreditOperationWorker(
      configuration(),
      store as unknown as CreditOperationStore,
      processor as unknown as ReservationOperationProcessor,
      processor as unknown as AdjustmentOperationProcessor,
    );

    await worker.runOnce();

    expect(store.markFailed).toHaveBeenCalledWith(
      operation.id,
      expect.any(String),
      'Credit operation execution failed (Error)',
      4_000,
    );
  });

  it('warns about overdue work without preventing processing', async () => {
    const warning = vi.spyOn(Logger.prototype, 'warn').mockImplementation();
    const operation = {
      id: '96ea8eb4-6c4a-40c8-a2a5-d673fba42033',
      operationType: 'RESERVE' as const,
      createdAt: new Date(Date.now() - 60_001),
      attemptCount: 8,
      lastError: 'earlier failure',
    };
    const processor = { processClaimed: vi.fn().mockResolvedValue({}) };
    const worker = new CreditOperationWorker(
      configuration(),
      {
        claim: vi.fn().mockResolvedValue([operation]),
        markFailed: vi.fn(),
      } as unknown as CreditOperationStore,
      processor as unknown as ReservationOperationProcessor,
      { processClaimed: vi.fn() } as unknown as AdjustmentOperationProcessor,
    );

    await worker.runOnce();

    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining(
        `Credit operation ${operation.id} remains pending`,
      ),
    );
    expect(processor.processClaimed).toHaveBeenCalledOnce();
    warning.mockRestore();
  });

  it('coalesces overlapping polls into one claim', async () => {
    let releaseClaim: (value: never[]) => void = () => undefined;
    const pendingClaim = new Promise<never[]>((resolve) => {
      releaseClaim = resolve;
    });
    const store = {
      claim: vi.fn().mockReturnValue(pendingClaim),
      markFailed: vi.fn(),
    };
    const worker = new CreditOperationWorker(
      configuration(),
      store as unknown as CreditOperationStore,
      { processClaimed: vi.fn() } as unknown as ReservationOperationProcessor,
      { processClaimed: vi.fn() } as unknown as AdjustmentOperationProcessor,
    );

    const first = worker.runOnce();
    const second = worker.runOnce();
    expect(first).toBe(second);
    releaseClaim([]);
    await first;
    expect(store.claim).toHaveBeenCalledTimes(1);
  });
});
