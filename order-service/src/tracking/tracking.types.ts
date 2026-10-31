// Shapes shared by the tracking module. Privacy: positions live only in Redis
// (short TTL) and are never logged or written to Postgres.

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Position extends LatLng {
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  // Server time (ms epoch) at which the update was accepted.
  ts: number;
}

export interface Route {
  // GeoJSON order: [lng, lat].
  polyline: [number, number][];
  distanceM: number;
  durationS: number;
  computedAt: number;
}

// What is cached in Redis: the route plus where the courier was when it was
// computed, so a later update can tell whether the courier has moved far enough
// to need a new one. `origin` is not exposed to clients.
export interface CachedRoute extends Route {
  origin: LatLng;
}

export type TrackingEvent =
  | ({ type: 'location' } & Position)
  | ({ type: 'route' } & Route)
  | { type: 'ended'; reason: string; status: string };

export interface TrackingSnapshot {
  errandId: string;
  status: string;
  tracking: boolean;
  position: Position | null;
  route: Route | null;
  destination: LatLng | null;
  serverTime: number;
}

export const locationKey = (errandId: string) => `order:loc:${errandId}`;
export const routeKey = (errandId: string) => `order:route:${errandId}`;
export const rateKey = (errandId: string) => `order:loc-rate:${errandId}`;
export const eventsChannel = (errandId: string) => `order:loc-events:${errandId}`;
