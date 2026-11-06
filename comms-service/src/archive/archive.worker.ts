import {
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/environment.js';
import { commsMetrics } from '../observability/comms-metrics.js';
import { ChatRealtimePublisher } from '../socket/chat-realtime.publisher.js';
import { ArchiveClaimService } from './archive-claim.service.js';
import { ArchiveService } from './archive.service.js';

/** Runs bounded archive cycles in every replica. */
@Injectable()
export class ArchiveWorker
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly logger = new Logger(ArchiveWorker.name);
  private readonly pollIntervalMs: number;
  private stopping = false;
  private timer?: ReturnType<typeof setTimeout>;
  private inFlight?: Promise<void>;

  constructor(
    config: ConfigService<EnvironmentVariables, true>,
    private readonly claims: ArchiveClaimService,
    private readonly archives: ArchiveService,
    private readonly realtime: ChatRealtimePublisher,
  ) {
    this.pollIntervalMs = config.get('ARCHIVE_POLL_INTERVAL_MS', {
      infer: true,
    });
  }

  onApplicationBootstrap(): void {
    this.schedule(0);
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.stopping = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    await this.inFlight;
  }

  async runOnce(): Promise<void> {
    const claimStarted = process.hrtime.bigint();
    let claims;
    try {
      claims = await this.claims.claimDueBatch();
      commsMetrics.observeArchiveClaim(
        'successful',
        elapsedSeconds(claimStarted),
      );
      commsMetrics.archiveClaimsInFlight(claims.length);
      if (claims.length === 0) commsMetrics.archiveClaim('empty');
      for (const claim of claims) {
        commsMetrics.archiveClaim(claim.reclaimed ? 'reclaimed' : 'claimed');
      }
    } catch (error) {
      commsMetrics.archiveClaim('failed');
      commsMetrics.observeArchiveClaim('failed', elapsedSeconds(claimStarted));
      commsMetrics.archiveClaimsInFlight(0);
      this.logFailure('archive:claim', error);
      return;
    }

    let remainingClaims = claims.length;
    for (const claim of claims) {
      const started = process.hrtime.bigint();
      try {
        const result = await this.archives.archive(claim);
        if (result.status === 'stale') {
          commsMetrics.observeArchive('stale', elapsedSeconds(started));
          continue;
        }
        commsMetrics.observeArchive('archived', elapsedSeconds(started));
        this.realtime.publishArchived(result.notification);
      } catch (error) {
        commsMetrics.observeArchive('failed', elapsedSeconds(started));
        this.logFailure('archive:commit', error);
      } finally {
        remainingClaims -= 1;
        commsMetrics.archiveClaimsInFlight(remainingClaims);
      }
    }
  }

  private schedule(delay: number): void {
    if (this.stopping) return;
    this.timer = setTimeout(() => {
      if (this.stopping) return;
      this.inFlight = this.runOnce().finally(() => {
        this.inFlight = undefined;
        this.schedule(this.pollIntervalMs);
      });
    }, delay);
  }

  private logFailure(operation: string, error: unknown): void {
    this.logger.error({
      operation,
      outcome: 'failed',
      errorClass:
        error instanceof Error ? error.constructor.name : 'UnknownError',
    });
  }
}

function elapsedSeconds(started: bigint): number {
  return Number(process.hrtime.bigint() - started) / 1_000_000_000;
}
