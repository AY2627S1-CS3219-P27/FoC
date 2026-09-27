import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';

const RETRYABLE_SQL_STATES = new Set(['40001', '40P01']);
const RETRY_DELAYS_MS = [25, 50, 100] as const;

function sqlState(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  if ('code' in error && typeof error.code === 'string') {
    return error.code;
  }
  if ('driverError' in error) {
    return sqlState(error.driverError);
  }
  return undefined;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Runs a complete business operation at SERIALIZABLE isolation. PostgreSQL
 * serialization failures and deadlocks are retried with full jitter; all
 * other failures are returned immediately to the caller.
 */
@Injectable()
export class SerializableTransactionRunner {
  constructor(private readonly dataSource: DataSource) {}

  async run<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.dataSource.transaction('SERIALIZABLE', work);
      } catch (error) {
        const maximumDelay = RETRY_DELAYS_MS[attempt];
        // The three configured delays mean one initial attempt plus at most
        // three retries. Exhaustion deliberately rethrows the final DB error.
        if (!RETRYABLE_SQL_STATES.has(sqlState(error) ?? '') || !maximumDelay) {
          throw error;
        }

        await wait(Math.floor(Math.random() * (maximumDelay + 1)));
      }
    }
  }
}
