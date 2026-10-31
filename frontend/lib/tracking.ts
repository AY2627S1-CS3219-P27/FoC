// Pure helpers for courier location tracking. No browser APIs, written to be unit-testable (the frontend has no test runner yet).

export interface TrackPosition {
  lat: number;
  lng: number;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  ts: string | number;
}

export interface TrackRoute {
  /** GeoJSON order: [lng, lat]. */
  polyline: [number, number][];
  distanceM: number;
  durationS: number;
  computedAt: string | number;
}

export interface TrackSnapshot {
  errandId: string;
  status: string;
  tracking: boolean;
  position: TrackPosition | null;
  route: TrackRoute | null;
  destination: { lat: number; lng: number } | null;
  serverTime: string | number;
}

export const STALE_AFTER_S = 60;
export const SEND_MIN_INTERVAL_MS = 5_000;
export const SEND_TICK_MS = 5_000;
export const SSE_WATCHDOG_MS = 60_000;
export const SEND_HEARTBEAT_MS = 15_000;
export const MOVE_THRESHOLD_M = 5;
export const POLL_FALLBACK_MS = 10_000;
export const SSE_MAX_FAILURES = 4;

export function toMs(ts: string | number): number {
  return typeof ts === "number" ? ts : new Date(ts).getTime();
}

/** Seconds since the position was recorded, clamped at 0. NaN timestamps count as unknown (null). */
export function ageSeconds(ts: string | number | null | undefined, nowMs: number): number | null {
  if (ts === null || ts === undefined) return null;
  const t = toMs(ts);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.round((nowMs - t) / 1000));
}

/** True when `incoming` is not older than `current` (or either is unknown/unparseable). */
export function isNewerOrEqual(
  incoming: { ts: string | number } | null,
  current: { ts: string | number } | null,
): boolean {
  if (!incoming) return false;
  if (!current) return true;
  const a = toMs(incoming.ts);
  const b = toMs(current.ts);
  if (Number.isNaN(a) || Number.isNaN(b)) return true;
  return a >= b;
}

/** Same ordering guard for routes, by computedAt. */
export function isRouteNewerOrEqual(
  incoming: { computedAt: string | number } | null,
  current: { computedAt: string | number } | null,
): boolean {
  return isNewerOrEqual(
    incoming && { ts: incoming.computedAt },
    current && { ts: current.computedAt },
  );
}

export function isStale(ageS: number | null): boolean {
  return ageS === null || ageS > STALE_AFTER_S;
}

export function formatAge(ageS: number | null): string {
  if (ageS === null) return "never";
  if (ageS < 60) return `${ageS} s ago`;
  const m = Math.floor(ageS / 60);
  return m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ago`;
}

export function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
}

export function formatEta(s: number): string {
  const min = Math.max(1, Math.round(s / 60));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
}

/** Great-circle distance in metres. */
export function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface SendState {
  lastSentAt: number | null;
  lastSent: { lat: number; lng: number } | null;
}

/**
 * Throttle: at most one send per SEND_MIN_INTERVAL_MS; within that, send only if the courier moved
 * at least MOVE_THRESHOLD_M, or SEND_HEARTBEAT_MS has passed since the last send.
 */
export function shouldSend(
  state: SendState,
  next: { lat: number; lng: number },
  nowMs: number,
): boolean {
  if (state.lastSentAt === null || state.lastSent === null) return true;
  const since = nowMs - state.lastSentAt;
  if (since < SEND_MIN_INTERVAL_MS) return false;
  if (since >= SEND_HEARTBEAT_MS) return true;
  return haversineM(state.lastSent, next) >= MOVE_THRESHOLD_M;
}

/** Exponential backoff with a cap: 1 s, 2 s, 4 s ... 30 s. `jitter` in [0,1) adds up to 25%. */
export function backoffMs(attempt: number, jitter = 0): number {
  const base = Math.min(30_000, 1_000 * 2 ** Math.max(0, attempt));
  return Math.round(base * (1 + 0.25 * jitter));
}

/** Round-trip safe coordinate bounds check mirroring the contract ranges (campus bounds are server-side). */
export function isValidCoord(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

export interface TileConfig {
  url: string;
  attribution: string;
}

const OSM_DEV_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/**
 * Tiles come from env. The public OSM tile server is permitted only in development (its usage policy
 * forbids production/heavy use). Returns null when no legal source is configured.
 * Attribution is always included (OSM's, when the configured one is empty).
 */
export function resolveTileConfig(
  env: { url?: string; attribution?: string; nodeEnv?: string },
): TileConfig | null {
  const url = env.url?.trim();
  const attribution = env.attribution?.trim();
  if (url) return { url, attribution: attribution || OSM_ATTRIBUTION };
  if (env.nodeEnv === "development") return { url: OSM_DEV_URL, attribution: OSM_ATTRIBUTION };
  return null;
}
