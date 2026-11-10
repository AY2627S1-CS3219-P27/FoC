import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/environment.schema.js';
import { IndexingService } from './indexing.service.js';

/** Doubles from the first delay; a failed attempt costs next to nothing. */
const RETRY_FIRST_DELAY_MS = 15_000;
const RETRY_MAX_DELAY_MS = 120_000;

/**
 * Brings the index up to date when the service starts, so a fresh stack needs
 * no manual step and an edited document takes effect on the next restart.
 *
 * Unlike supplier-service's seed, which only reads a local file, this depends
 * on an outside company. So startup does not wait for it. A failure leaves any
 * existing index answering and is retried until it works, so the bot recovers
 * from an outage without a restart.
 */
@Injectable()
export class StartupIndexerService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(StartupIndexerService.name);
  private retryTimer?: NodeJS.Timeout;
  private failedAttempts = 0;
  private stopped = false;

  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
    private readonly indexing: IndexingService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.get('INDEX_ON_STARTUP', { infer: true })) {
      this.logger.debug(
        'Skipping startup indexing: INDEX_ON_STARTUP is false.',
      );
      return;
    }
    void this.bringUpToDate();
  }

  onApplicationShutdown(): void {
    this.stopped = true;
    clearTimeout(this.retryTimer);
  }

  /** Never rejects. */
  async bringUpToDate(): Promise<void> {
    try {
      if (await this.indexing.isUpToDate()) {
        this.logger.log('The index already matches the help documents.');
        return;
      }
      this.logger.log('The help documents changed: re-indexing.');
      await this.indexing.reindex();
    } catch (error) {
      this.retryLater(error);
    }
  }

  private retryLater(error: unknown): void {
    const delayMs = Math.min(
      RETRY_FIRST_DELAY_MS * 2 ** this.failedAttempts,
      RETRY_MAX_DELAY_MS,
    );
    this.failedAttempts += 1;
    this.logger.error(
      `Startup indexing failed; any existing index stays in use, retrying in ${
        delayMs / 1000
      } s: ${error instanceof Error ? error.message : String(error)}`,
    );
    if (this.stopped) {
      return;
    }
    this.retryTimer = setTimeout(() => void this.bringUpToDate(), delayMs);
    this.retryTimer.unref();
  }
}
