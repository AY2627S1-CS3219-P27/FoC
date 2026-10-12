import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type BeforeApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type pg from 'pg';
import { DB, POOL } from '../db/db.module.js';
import type { Db } from '../lifecycle/transition.js';
import { SWEEP_LOCK_KEY, withAdvisoryLock } from './sweep-lock.js';
import { runSweeps, type SweepConfig } from './sweeps.js';

/** Runs every sweep on a timer, on one instance at a time (ADR 0003). */
@Injectable()
export class SweepsLifecycle
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly logger = new Logger(SweepsLifecycle.name);
  private readonly cfg: SweepConfig;
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(POOL) private readonly pool: pg.Pool,
    private readonly config: ConfigService,
  ) {
    this.cfg = {
      reservingTimeoutMs: config.getOrThrow('RESERVING_CREDIT_TIMEOUT_MS'),
      replyTimeoutMs: config.getOrThrow('CREDIT_REPLY_TIMEOUT_MS'),
      resendMax: config.getOrThrow('CREDIT_RESEND_MAX'),
    };
  }

  onApplicationBootstrap(): void {
    this.timer = setInterval(
      () => void this.tick(),
      this.config.getOrThrow<number>('SWEEP_INTERVAL_MS'),
    );
  }

  // Before (not on) shutdown: DbModule closes the pool on shutdown, after this tick has drained.
  async beforeApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    await this.running;
  }

  // A slow tick makes the next one skip rather than overlap.
  tick(): Promise<void> {
    return (this.running ??= this.runOnce().finally(() => {
      this.running = undefined;
    }));
  }

  private async runOnce(): Promise<void> {
    try {
      const res = await withAdvisoryLock(this.pool, SWEEP_LOCK_KEY, () =>
        runSweeps(this.db, this.cfg),
      );
      if (res.ran && Object.values(res.value).some((n) => n > 0)) {
        this.logger.log(JSON.stringify(res.value));
      }
    } catch (e) {
      this.logger.error(`sweep tick failed: ${String(e)}`);
    }
  }
}
