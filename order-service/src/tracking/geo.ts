import type { LatLng } from './tracking.types.js';

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

// Great-circle distance in metres.
export function haversineM(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// [minLon, minLat, maxLon, maxLat]
export type Bbox = readonly [number, number, number, number];

export const inBbox = (p: LatLng, [minLon, minLat, maxLon, maxLat]: Bbox) =>
  p.lng >= minLon && p.lng <= maxLon && p.lat >= minLat && p.lat <= maxLat;
