import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/environment.js';
import { AdjustmentOperationProcessor } from './adjustment-operation.processor.js';
import {
  CreditOperationStore,
  type ClaimedCreditOperation,
} from './credit-operation.store.js';
import { ReservationOperationProcessor } from './reservation-operation.processor.js';

const CLAIM_BATCH_SIZE = 10;
const MAX_FAILURE_LENGTH = 512;

export function creditOperationRetryDelay(
  attemptCount: number,
  baseDelayMilliseconds: number,
  maximumDelayMilliseconds: number,
): number {
  const maximumExponent = Math.ceil(
    Math.log2(maximumDelayMilliseconds / baseDelayMilliseconds),
  );
  const exponent = Math.min(Math.max(0, attemptCount - 1), maximumExponent);
  return Math.min(
    maximumDelayMilliseconds,
    baseDelayMilliseconds * 2 ** exponent,
  );
}

function safeFailure(error: unknown): string {
  const name = error instanceof Error ? error.name : 'Error';
  return `Credit operation execution failed (${name})`.slice(
    0,
    MAX_FAILURE_LENGTH,
  );
}

function safeDiagnostic(value: string | null): string {
  return (value ?? 'none')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, MAX_FAILURE_LENGTH);
}

/** Polls and executes leased credit operations without overlapping batches. */
@Injectable()
export class CreditOperationWorker {
  private readonly logger = new Logger(CreditOperationWorker.name);
  private readonly workerId = randomUUID();
  private readonly pollIntervalMilliseconds: number;
  private readonly claimLeaseMilliseconds: number;
  private readonly maximumBackoffMilliseconds: number;
  private readonly stuckAfterMilliseconds: number;
  private started = false;
  private stopping = false;
  private timer?: NodeJS.Timeout;
  private activePoll?: Promise<void>;

  constructor(
    config: ConfigService<EnvironmentVariables, true>,
    private readonly store: CreditOperationStore,
    private readonly reservationProcessor: ReservationOperationProcessor,
    private readonly adjustmentProcessor: AdjustmentOperationProcessor,
  ) {
    this.pollIntervalMilliseconds = config.getOrThrow(
      'CREDIT_OPERATION_POLL_INTERVAL_MS',
    );
    this.claimLeaseMilliseconds = config.getOrThrow(
      'CREDIT_OPERATION_CLAIM_LEASE_MS',
    );
    this.maximumBackoffMilliseconds = config.getOrThrow(
      'CREDIT_OPERATION_MAX_BACKOFF_MS',
    );
    this.stuckAfterMilliseconds = config.getOrThrow(
      'CREDIT_OPERATION_STUCK_AFTER_MS',
    );
  }

  async start(): Promise<void> {
    if (this.started) {
      throw new Error('Credit operation worker has already been started');
    }
    this.started = true;
    this.stopping = false;
    try {
      await this.runOnce();
      this.scheduleNext();
    } catch (error) {
      this.started = false;
      throw error;
    }
  }

  runOnce(): Promise<void> {
    if (this.activePoll) {
      return this.activePoll;
    }
    const poll = this.processBatch().finally(() => {
      if (this.activePoll === poll) {
        this.activePoll = undefined;
      }
    });
    this.activePoll = poll;
    return poll;
  }

  async close(): Promise<void> {
    if (this.stopping || !this.started) {
      return;
    }
    this.stopping = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    await this.activePoll;
  }

  private async processBatch(): Promise<void> {
    const operations = await this.store.claim(
      this.workerId,
      CLAIM_BATCH_SIZE,
      this.claimLeaseMilliseconds,
    );
    await Promise.all(
      operations.map((operation) => this.processOne(operation)),
    );
  }

  private async processOne(operation: ClaimedCreditOperation): Promise<void> {
    this.warnIfStuck(operation);
    try {
      if (operation.operationType === 'RESERVE') {
        await this.reservationProcessor.processClaimed(
          operation.id,
          this.workerId,
        );
      } else if (operation.operationType === 'ADJUST') {
        await this.adjustmentProcessor.processClaimed(
          operation.id,
          this.workerId,
        );
      } else {
        throw new Error('Unsupported credit operation type');
      }
    } catch (error) {
      const failure = safeFailure(error);
      const retryDelay = creditOperationRetryDelay(
        operation.attemptCount,
        this.pollIntervalMilliseconds,
        this.maximumBackoffMilliseconds,
      );
      try {
        await this.store.markFailed(
          operation.id,
          this.workerId,
          failure,
          retryDelay,
        );
      } catch (persistenceError) {
        this.logger.error(
          `Unable to record operation failure for ${operation.id}: ${safeFailure(persistenceError)}`,
        );
      }
    }
  }

  private warnIfStuck(operation: ClaimedCreditOperation): void {
    const ageMilliseconds = Math.max(
      0,
      Date.now() - operation.createdAt.getTime(),
    );
    if (ageMilliseconds < this.stuckAfterMilliseconds) {
      return;
    }
    this.logger.warn(
      `Credit operation ${operation.id} remains pending after ${ageMilliseconds}ms; attempt=${operation.attemptCount}; lastError=${safeDiagnostic(operation.lastError)}`,
    );
  }

  private scheduleNext(): void {
    if (this.stopping) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.runOnce()
        .catch((error) => {
          this.logger.error(
            `Credit operation polling failed: ${safeFailure(error)}`,
          );
        })
        .finally(() => this.scheduleNext());
    }, this.pollIntervalMilliseconds);
  }
}
