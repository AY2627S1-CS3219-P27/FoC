import { type AuthenticatedRequest, JwtAuthGuard, Roles, RolesGuard } from '@foc/auth';
import { Role } from '@foc/contracts';
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Sse,
  UseGuards,
  type MessageEvent,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { toApiStatus } from '../errands/api-status.js';
import { TRACKING_CONFIG, type TrackingConfig } from './tracking.config.js';
import { LocationDto } from './tracking.dto.js';
import { TrackingService } from './tracking.service.js';
import type { TrackingEvent, TrackingSnapshot } from './tracking.types.js';

// Live courier tracking. Privacy: no coordinates or bodies are logged here.
@Controller('v1/errands')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TrackingController {
  constructor(
    private readonly tracking: TrackingService,
    @Inject(TRACKING_CONFIG) private readonly config: TrackingConfig,
  ) {}

  @Post(':id/location')
  @Roles(Role.Courier)
  @HttpCode(204)
  async location(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: LocationDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.tracking.updateLocation(id, req.user.sub, body);
  }

  @Get(':id/tracking/snapshot')
  @Roles(Role.Requester, Role.Courier)
  snapshot(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthenticatedRequest) {
    return this.tracking.snapshot(id, req.user.sub);
  }

  @Sse(':id/tracking')
  @Roles(Role.Requester, Role.Courier)
  @Header('Cache-Control', 'no-cache')
  @Header('X-Accel-Buffering', 'no')
  @Header('Connection', 'keep-alive')
  async stream(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<Observable<MessageEvent>> {
    // Throws 404 before any stream is opened.
    await this.tracking.authorizeParty(id, req.user.sub);
    const keepaliveMs = this.config.sseKeepaliveMs;

    return new Observable<MessageEvent>((subscriber) => {
      let closed = false;
      let release: (() => Promise<void>) | undefined;
      let timer: NodeJS.Timeout | undefined;
      const buffer: TrackingEvent[] = [];
      let live = false;

      const finish = () => {
        if (closed) return;
        closed = true;
        if (timer) clearInterval(timer);
        void release?.().catch(() => undefined);
        subscriber.complete();
      };
      const emit = (event: TrackingEvent) => {
        if (closed) return;
        if (event.type === 'ended') {
          subscriber.next({ type: 'ended', data: { reason: event.reason, status: event.status } });
          finish();
        } else {
          const { type, ...data } = event;
          subscriber.next({ type, data });
        }
      };

      // Subscribe first, then snapshot, so no update falls in the gap.
      this.tracking
        .subscribe(id, (e) => (live ? emit(e) : buffer.push(e)))
        .then(async (unsubscribe) => {
          release = unsubscribe;
          if (closed) return void unsubscribe();
          const snap: TrackingSnapshot = await this.tracking.snapshot(id, req.user.sub);
          if (closed) return;
          subscriber.next({ type: 'snapshot', data: snap });
          if (!snap.tracking) {
            return emit({ type: 'ended', reason: 'NOT_TRACKING', status: snap.status });
          }
          live = true;
          for (const e of buffer.splice(0)) emit(e);
          if (!closed) {
            let checking = false;
            timer = setInterval(() => {
              if (closed) return;
              subscriber.next({ type: 'keepalive', data: {} });
              if (checking) return;
              checking = true;
              // Safety net for a missed end hook: re-read the errand and end
              // the stream if it is no longer being tracked.
              this.tracking
                .authorizeParty(id, req.user.sub)
                .then((e) => {
                  if (e.status !== 'Picked Up') {
                    emit({ type: 'ended', reason: 'NOT_TRACKING', status: toApiStatus(e.status) });
                  }
                })
                .catch(() => emit({ type: 'ended', reason: 'NOT_TRACKING', status: 'Unknown' }))
                .finally(() => (checking = false));
            }, keepaliveMs);
          }
        })
        .catch(() => {
          // Redis down etc.: end the stream; the client reconnects.
          finish();
        });

      // Runs on client disconnect (Nest unsubscribes) and on completion.
      return () => {
        closed = true;
        if (timer) clearInterval(timer);
        void release?.().catch(() => undefined);
      };
    });
  }
}
