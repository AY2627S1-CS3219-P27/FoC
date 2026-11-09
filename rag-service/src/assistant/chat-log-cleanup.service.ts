import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/environment.schema.js';
import { ChatLogRepository } from './chat-log.repository.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Deletes old questions at startup and once a day. */
@Injectable()
export class ChatLogCleanupService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(ChatLogCleanupService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly chatLog: ChatLogRepository,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  onApplicationBootstrap(): void {
    void this.deleteOldRows();
    this.timer = setInterval(() => void this.deleteOldRows(), DAY_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  /** Never rejects: a failed clean-up is retried the next day. */
  async deleteOldRows(): Promise<void> {
    try {
      const deleted = await this.chatLog.deleteOlderThan(
        this.config.get('CHAT_LOG_RETENTION_DAYS', { infer: true }),
      );
      if (deleted > 0) {
        this.logger.log(`Deleted ${deleted} old chat_log rows`);
      }
    } catch (error) {
      this.logger.error(
        `chat_log clean-up failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
