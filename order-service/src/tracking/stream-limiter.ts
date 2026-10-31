import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { TRACKING_CONFIG, type TrackingConfig } from './tracking.config.js';

// Caps concurrent SSE streams per errand and per user. Counted in this process
// only (each replica enforces its own cap).
@Injectable()
export class StreamLimiter {
  private readonly perErrand = new Map<string, number>();
  private readonly perUser = new Map<string, number>();

  constructor(@Inject(TRACKING_CONFIG) private readonly config: TrackingConfig) {}

  // Returns an idempotent release function, or throws 429 TOO_MANY_STREAMS.
  acquire(errandId: string, userId: string): () => void {
    if (
      (this.perErrand.get(errandId) ?? 0) >= this.config.maxStreamsPerErrand ||
      (this.perUser.get(userId) ?? 0) >= this.config.maxStreamsPerUser
    ) {
      throw new HttpException(
        { code: 'TOO_MANY_STREAMS', message: 'Too many open tracking streams.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    bump(this.perErrand, errandId, 1);
    bump(this.perUser, userId, 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      bump(this.perErrand, errandId, -1);
      bump(this.perUser, userId, -1);
    };
  }

  // Open streams (diagnostics / tests).
  get open(): number {
    let n = 0;
    for (const v of this.perErrand.values()) n += v;
    return n;
  }
}

function bump(m: Map<string, number>, key: string, d: number) {
  const n = (m.get(key) ?? 0) + d;
  if (n <= 0) m.delete(key);
  else m.set(key, n);
}
