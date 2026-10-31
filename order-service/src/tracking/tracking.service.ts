import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { toApiStatus } from '../errands/api-status.js';
import { onTransitionCommitted } from '../lifecycle/transition-hooks.js';
import { ERRAND_READER, type ErrandReader, type TrackedErrand } from './errand-reader.js';
import { haversineM, inBbox } from './geo.js';
import {
  DESTINATION_RESOLVER,
  ROUTING_PROVIDER,
  type DestinationResolver,
  type RoutingProvider,
} from './routing.js';
import { TRACKING_CONFIG, type TrackingConfig } from './tracking.config.js';
import type { LocationDto } from './tracking.dto.js';
import { TRACKING_STORE, type TrackingStore } from './tracking.store.js';
import type { LatLng, Position, Route, TrackingEvent, TrackingSnapshot } from './tracking.types.js';

const TRACKING_STATUS = 'Picked Up';
// After a failed routing attempt, leave OSRM alone for this long (per errand).
const ROUTE_FAILURE_COOLDOWN_MS = 10_000;

const toRoute = ({ polyline, distanceM, durationS, computedAt }: Route): Route => ({
  polyline,
  distanceM,
  durationS,
  computedAt,
});

// NOTE: nothing in this class may log lat/lng or request bodies.
@Injectable()
export class TrackingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Tracking');
  private offHook?: () => void;
  private readonly routing = new Set<string>();
  private readonly routeFailedAt = new Map<string, number>();

  constructor(
    @Inject(ERRAND_READER) private readonly errands: ErrandReader,
    @Inject(TRACKING_STORE) private readonly store: TrackingStore,
    @Inject(ROUTING_PROVIDER) private readonly routingProvider: RoutingProvider,
    @Inject(DESTINATION_RESOLVER) private readonly destinations: DestinationResolver,
    @Inject(TRACKING_CONFIG) private readonly config: TrackingConfig,
  ) {}

  // Overridable clock (tests).
  now: () => number = Date.now;

  onModuleInit() {
    // Edges 12 (Picked Up -> Delivered) and 13 (Picked Up -> Cancelled).
    this.offHook = onTransitionCommitted((t) => {
      if (t.expected !== TRACKING_STATUS) return;
      if (t.to === 'Delivered') return this.endTracking(t.errandId, 'DELIVERED', 'Delivered');
      if (t.to === 'Cancelled') return this.endTracking(t.errandId, 'CANCELLED', 'Cancelled');
    });
  }

  onModuleDestroy() {
    this.offHook?.();
  }

  // Best-effort cleanup after the errand left Picked Up. Never throws: TTLs are
  // the safety net.
  async endTracking(errandId: string, reason: string, status: string): Promise<void> {
    this.routeFailedAt.delete(errandId);
    try {
      await this.store.clear(errandId);
      await this.store.publish(errandId, { type: 'ended', reason, status });
    } catch (e) {
      this.logger.warn(`tracking cleanup failed for errand ${errandId}: ${(e as Error)?.name ?? 'error'}`);
    }
  }

  // 503 while Redis is unreachable (tracking is a side feature; the rest of
  // order-service keeps working).
  assertAvailable(): void {
    if (!this.store.isReady()) {
      throw new ServiceUnavailableException({
        code: 'TRACKING_UNAVAILABLE',
        message: 'Live tracking is temporarily unavailable.',
      });
    }
  }

  private async stillTracking(errandId: string): Promise<boolean> {
    return (await this.errands.find(errandId))?.status === TRACKING_STATUS;
  }

  // Location update from the assigned courier. Resolves normally for both
  // stored and rate-limit-dropped updates (the caller answers 204 either way).
  async updateLocation(errandId: string, callerId: string, dto: LocationDto): Promise<void> {
    this.assertAvailable();
    const errand = await this.errands.find(errandId);
    if (!errand) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Errand not found.' });
    if (errand.courierId !== callerId) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'You are not the courier of this errand.' });
    }
    if (errand.status !== TRACKING_STATUS) {
      throw new ConflictException({
        code: 'STATE_MISMATCH',
        message: 'Location can only be shared while the errand is picked up.',
      });
    }
    if (!inBbox(dto, this.config.bbox)) {
      throw new BadRequestException({
        code: 'INVALID_FIELDS',
        message: 'The position is outside the supported area.',
      });
    }
    if (!(await this.store.acquireRateSlot(errandId, this.config.minUpdateIntervalMs))) return;

    const position: Position = {
      lat: dto.lat,
      lng: dto.lng,
      accuracy: dto.accuracy ?? null,
      heading: dto.heading ?? null,
      speed: dto.speed ?? null,
      ts: this.now(),
    };
    try {
      await this.store.setPosition(errandId, position, this.config.locationTtlS);
    } catch (e) {
      // The update was not stored, so it must not use up the rate slot.
      await this.store.releaseRateSlot(errandId).catch(() => undefined);
      throw e;
    }
    // A POST racing Delivered/Cancelled must not leave a position behind.
    if (!(await this.stillTracking(errandId))) {
      await this.store.clear(errandId);
      return;
    }
    await this.store.publish(errandId, { type: 'location', ...position });
    void this.refreshRoute(errandId, position);
  }

  // Forget failures older than the cooldown so the map cannot grow unbounded.
  private pruneFailures() {
    const now = this.now();
    for (const [id, at] of this.routeFailedAt) {
      if (now - at >= ROUTE_FAILURE_COOLDOWN_MS) this.routeFailedAt.delete(id);
    }
  }

  // Recomputes the route only when there is none cached (never computed, or
  // expired) or the courier moved > TRACKING_REROUTE_DISTANCE_M from the cached
  // route's origin. Runs in the background; never throws.
  async refreshRoute(errandId: string, position: LatLng): Promise<void> {
    this.pruneFailures();
    if (this.routing.has(errandId)) return;
    this.routing.add(errandId);
    try {
      const destination = await this.destinations.resolve(errandId);
      if (!destination) return;
      const cached = await this.store.getRoute(errandId);
      if (cached && haversineM(cached.origin, position) <= this.config.rerouteDistanceM) return;
      const failedAt = this.routeFailedAt.get(errandId);
      if (failedAt !== undefined && this.now() - failedAt < ROUTE_FAILURE_COOLDOWN_MS) return;

      const origin = { lat: position.lat, lng: position.lng };
      const route = await this.routingProvider.route(origin, destination);
      if (!route) {
        this.routeFailedAt.set(errandId, this.now());
        return;
      }
      this.routeFailedAt.delete(errandId);
      // Tracking may have ended while OSRM was thinking: cache nothing then.
      if (!(await this.stillTracking(errandId))) return;
      await this.store.setRoute(errandId, { ...route, origin }, this.config.routeTtlS);
      if (!(await this.stillTracking(errandId))) {
        // Ended during the write: remove what we just cached.
        await this.store.clear(errandId);
        return;
      }
      await this.store.publish(errandId, { type: 'route', ...toRoute(route) });
    } catch (e) {
      this.logger.warn(`route refresh failed for errand ${errandId}: ${(e as Error)?.name ?? 'error'}`);
    } finally {
      this.routing.delete(errandId);
    }
  }

  // Requester or courier of the errand; anyone else (or no errand) gets 404.
  async authorizeParty(errandId: string, callerId: string): Promise<TrackedErrand> {
    const errand = await this.errands.find(errandId);
    if (!errand || (errand.requesterId !== callerId && errand.courierId !== callerId)) {
      throw new NotFoundException('Errand not found.');
    }
    return errand;
  }

  async snapshotOf(errand: TrackedErrand): Promise<TrackingSnapshot> {
    const tracking = errand.status === TRACKING_STATUS;
    const [position, cached, destination] = tracking
      ? await Promise.all([
          this.store.getPosition(errand.id),
          this.store.getRoute(errand.id),
          this.destinations.resolve(errand.id),
        ])
      : [null, null, await this.destinations.resolve(errand.id)];
    return {
      errandId: errand.id,
      status: toApiStatus(errand.status),
      tracking,
      position,
      route: cached ? toRoute(cached) : null,
      destination,
      serverTime: this.now(),
    };
  }

  async snapshot(errandId: string, callerId: string): Promise<TrackingSnapshot> {
    this.assertAvailable();
    return this.snapshotOf(await this.authorizeParty(errandId, callerId));
  }

  subscribe(errandId: string, onEvent: (e: TrackingEvent) => void) {
    return this.store.subscribe(errandId, onEvent);
  }
}
