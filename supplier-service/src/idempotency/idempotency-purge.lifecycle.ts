import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { IdempotencyService } from './idempotency.service.js';

const PURGE_INTERVAL_MS = 60 * 60 * 1000;

/** Removes idempotency keys older than 24 hours, at start and then hourly. */
@Injectable()
export class IdempotencyPurge
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(IdempotencyPurge.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly idempotency: IdempotencyService) {}

  onApplicationBootstrap(): void {
    void this.purge();
    this.timer = setInterval(() => void this.purge(), PURGE_INTERVAL_MS);
    // Never keeps the process alive on its own.
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  private async purge(): Promise<void> {
    try {
      const removed = await this.idempotency.purgeExpired();
      if (removed > 0) {
        this.logger.log(`removed ${removed} expired idempotency keys`);
      }
    } catch (error) {
      this.logger.warn(`could not purge idempotency keys: ${String(error)}`);
    }
  }
}
