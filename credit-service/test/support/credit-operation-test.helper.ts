import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import {
  CreditOperation,
  type CreditOperationType,
} from '../../src/database/entities/index.js';
import type { CreditOperationStore } from '../../src/reservation/credit-operation.store.js';

const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_LEASE_MILLISECONDS = 30_000;
const DEFAULT_TIMEOUT_MILLISECONDS = 5_000;
const POLL_INTERVAL_MILLISECONDS = 5;

type ProcessClaimedOperation = (
  operationId: string,
  workerId: string,
) => Promise<unknown>;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function waitForOperationToComplete(
  dataSource: DataSource,
  operationId: string,
  timeoutMilliseconds = DEFAULT_TIMEOUT_MILLISECONDS,
): Promise<CreditOperation> {
  const operations = dataSource.getRepository(CreditOperation);
  const deadline = Date.now() + timeoutMilliseconds;
  let lastObserved: CreditOperation | null = null;

  while (Date.now() < deadline) {
    lastObserved = await operations.findOneBy({ id: operationId });
    if (!lastObserved) {
      throw new Error(`Credit operation ${operationId} no longer exists`);
    }
    if (lastObserved.status !== 'PENDING') {
      return lastObserved;
    }
    await delay(POLL_INTERVAL_MILLISECONDS);
  }

  throw new Error(
    `Timed out waiting for credit operation ${operationId} to complete; ` +
      `last status=${lastObserved?.status ?? 'missing'}, ` +
      `claimedBy=${lastObserved?.claimedBy ?? 'none'}, ` +
      `claimedUntil=${lastObserved?.claimedUntil?.toISOString() ?? 'none'}`,
  );
}

export async function claimDueOperationsAndWait(options: {
  dataSource: DataSource;
  operationStore: CreditOperationStore;
  operationId: string;
  expectedOperationType: CreditOperationType;
  processClaimed: ProcessClaimedOperation;
}): Promise<CreditOperation> {
  const workerId = randomUUID();
  const claimed = await options.operationStore.claim(
    workerId,
    DEFAULT_BATCH_SIZE,
    DEFAULT_LEASE_MILLISECONDS,
  );

  await Promise.all(
    claimed.map(async (operation) => {
      if (operation.operationType !== options.expectedOperationType) {
        throw new Error(
          `Expected ${options.expectedOperationType} operation but claimed ` +
            `${operation.operationType} operation ${operation.id}`,
        );
      }
      await options.processClaimed(operation.id, workerId);
    }),
  );

  return waitForOperationToComplete(options.dataSource, options.operationId);
}
