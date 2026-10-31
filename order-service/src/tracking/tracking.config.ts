import { ConfigService } from '@nestjs/config';
import type { Bbox } from './geo.js';

export const TRACKING_CONFIG = Symbol('TRACKING_CONFIG');

export interface TrackingConfig {
  locationTtlS: number;
  minUpdateIntervalMs: number;
  sseKeepaliveMs: number;
  bbox: Bbox;
  routeTtlS: number;
  rerouteDistanceM: number;
  osrmBaseUrl: string;
  osrmTimeoutMs: number;
  maxStreamsPerErrand: number;
  maxStreamsPerUser: number;
}

export const trackingConfigFrom = (c: ConfigService): TrackingConfig => ({
  locationTtlS: c.getOrThrow<number>('TRACKING_LOCATION_TTL_S'),
  minUpdateIntervalMs: c.getOrThrow<number>('TRACKING_MIN_UPDATE_INTERVAL_MS'),
  sseKeepaliveMs: c.getOrThrow<number>('TRACKING_SSE_KEEPALIVE_MS'),
  bbox: c.getOrThrow<number[]>('TRACKING_BBOX') as unknown as Bbox,
  routeTtlS: c.getOrThrow<number>('TRACKING_ROUTE_TTL_S'),
  rerouteDistanceM: c.getOrThrow<number>('TRACKING_REROUTE_DISTANCE_M'),
  osrmBaseUrl: c.getOrThrow<string>('OSRM_BASE_URL'),
  osrmTimeoutMs: c.getOrThrow<number>('OSRM_TIMEOUT_MS'),
  maxStreamsPerErrand: c.getOrThrow<number>('TRACKING_MAX_STREAMS_PER_ERRAND'),
  maxStreamsPerUser: c.getOrThrow<number>('TRACKING_MAX_STREAMS_PER_USER'),
});
