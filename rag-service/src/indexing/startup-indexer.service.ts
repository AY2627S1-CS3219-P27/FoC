import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/environment.schema.js';
import { IndexingService } from './indexing.service.js';

/**
 * Brings the index up to date when the service starts, so a fresh stack needs
 * no manual step and an edited document takes effect on the next restart.
 *
 * Unlike supplier-service's seed, which only reads a local file, this depends
 * on an outside company. So startup does not wait for it, and a failure is
 * logged and leaves any existing index answering.
 */
@Injectable()
export class StartupIndexerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(StartupIndexerService.name);

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
      this.logger.error(
        `Startup indexing failed; any existing index stays in use: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
