import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/environment.js';
import type { ClaimedOutboxEvent } from './outbox-publication.types.js';
import { OutboxStore } from './outbox.store.js';
import { RabbitMqOutboxPublisher } from './rabbitmq-outbox.publisher.js';

const MAX_FAILURE_LENGTH = 512;

function safeFailure(error: unknown): string {
  const name = error instanceof Error ? error.name : 'Error';
  return `RabbitMQ outbox publication failed (${name})`.slice(
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

/**
 * Polls without overlap, then handles every claimed row independently. Broker
 * confirmation can therefore complete rows concurrently without one failure
 * holding the rest of the batch.
 */
@Injectable()
export class OutboxRelay {
  private readonly logger = new Logger(OutboxRelay.name);
  private readonly workerId = randomUUID();
  private readonly pollIntervalMilliseconds: number;
  private readonly batchSize: number;
  private readonly claimLeaseMilliseconds: number;
  private readonly warningMilliseconds: number;
  private started = false;
  private stopping = false;
  private timer?: NodeJS.Timeout;
  private activePoll?: Promise<void>;

  constructor(
    config: ConfigService<EnvironmentVariables, true>,
    private readonly store: OutboxStore,
    private readonly publisher: RabbitMqOutboxPublisher,
  ) {
    this.pollIntervalMilliseconds = config.getOrThrow(
      'OUTBOX_POLL_INTERVAL_MS',
    );
    this.batchSize = config.getOrThrow('OUTBOX_BATCH_SIZE');
    this.claimLeaseMilliseconds = config.getOrThrow('OUTBOX_CLAIM_LEASE_MS');
    this.warningMilliseconds = config.getOrThrow(
      'OUTBOX_UNPUBLISHED_WARNING_MS',
    );
  }

  async start(): Promise<void> {
    if (this.started) {
      throw new Error('Outbox relay has already been started');
    }

    this.started = true;
    this.stopping = false;
    try {
      await this.publisher.start();
      await this.runOnce();
      this.scheduleNext();
    } catch (error) {
      this.started = false;
      await this.publisher.close();
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
    await this.publisher.close();
  }

  private async processBatch(): Promise<void> {
    const events = await this.store.claim(
      this.workerId,
      this.batchSize,
      this.claimLeaseMilliseconds,
    );
    await Promise.all(events.map((event) => this.publishOne(event)));
  }

  private async publishOne(event: ClaimedOutboxEvent): Promise<void> {
    this.warnIfStale(event);
    try {
      await this.publisher.publish(event);
      const completed = await this.store.markPublished(
        event.eventId,
        this.workerId,
      );
      if (!completed) {
        this.logger.warn(
          `Outbox event ${event.eventId} was confirmed after its claim was lost`,
        );
      }
    } catch (error) {
      const failure = safeFailure(error);
      try {
        await this.store.markFailed(event.eventId, this.workerId, failure);
      } catch (persistenceError) {
        this.logger.error(
          `Unable to record outbox failure for ${event.eventId}: ${safeFailure(persistenceError)}`,
        );
      }
    }
  }

  private warnIfStale(event: ClaimedOutboxEvent): void {
    const ageMilliseconds = Math.max(0, Date.now() - event.createdAt.getTime());
    if (ageMilliseconds < this.warningMilliseconds) {
      return;
    }

    this.logger.warn(
      `Outbox event ${event.eventId} remains unpublished after ${ageMilliseconds}ms; attempt=${event.attemptCount}; lastError=${safeDiagnostic(event.lastError)}`,
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
          this.logger.error(`Outbox polling failed: ${safeFailure(error)}`);
        })
        .finally(() => this.scheduleNext());
    }, this.pollIntervalMilliseconds);
  }
}
