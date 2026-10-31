import { Logger } from '@nestjs/common';
import type { LatLng, Route } from './tracking.types.js';

export const ROUTING_PROVIDER = Symbol('ROUTING_PROVIDER');
export const DESTINATION_RESOLVER = Symbol('DESTINATION_RESOLVER');

export interface RoutingProvider {
  // Never throws: any failure yields null.
  route(from: LatLng, to: LatLng): Promise<Route | null>;
}

// Where an errand is going. KNOWN GAP: order-service stores only a free-text
// `deliveryLocation` (no coordinates), so the default resolver returns null and
// no route is ever computed in production yet. When delivery coordinates exist,
// provide another implementation under DESTINATION_RESOLVER; nothing else changes.
export interface DestinationResolver {
  resolve(errandId: string): Promise<LatLng | null>;
}

export class NullDestinationResolver implements DestinationResolver {
  async resolve(): Promise<LatLng | null> {
    return null;
  }
}

export interface OsrmOptions {
  baseUrl: string;
  timeoutMs: number;
  fetchFn?: typeof fetch;
  now?: () => number;
}

export class OsrmRoutingProvider implements RoutingProvider {
  private readonly logger = new Logger('OsrmRoutingProvider');

  constructor(private readonly opts: OsrmOptions) {}

  async route(from: LatLng, to: LatLng): Promise<Route | null> {
    const base = this.opts.baseUrl.replace(/\/+$/, '');
    const url =
      `${base}/route/v1/foot/${from.lng},${from.lat};${to.lng},${to.lat}` +
      `?overview=full&geometries=geojson`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);
    try {
      const res = await (this.opts.fetchFn ?? fetch)(url, { signal: controller.signal });
      if (!res.ok) return null;
      const body = (await res.json()) as {
        code?: string;
        routes?: { distance?: number; duration?: number; geometry?: { coordinates?: unknown } }[];
      };
      const r = body.routes?.[0];
      const coords = r?.geometry?.coordinates;
      if (
        body.code !== 'Ok' ||
        !r ||
        typeof r.distance !== 'number' ||
        typeof r.duration !== 'number' ||
        !Array.isArray(coords)
      ) {
        return null;
      }
      return {
        polyline: coords as [number, number][],
        distanceM: r.distance,
        durationS: r.duration,
        computedAt: (this.opts.now ?? Date.now)(),
      };
    } catch (e) {
      // Do not log the URL: it contains coordinates.
      this.logger.warn(`routing failed: ${(e as Error)?.name ?? 'error'}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
