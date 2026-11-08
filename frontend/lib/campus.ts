type Ring = number[][]; // [lng, lat] pairs, GeoJSON order
type Polygon = Ring[]; // outer ring, then holes

export interface CampusBoundary {
  contains: (latitude: number, longitude: number) => boolean;
  /** [[south, west], [north, east]] of the outer rings, for Leaflet. */
  bounds: [[number, number], [number, number]];
}

// Ray casting, the same algorithm as order-service's campus-boundary.ts (which has the edge-case tests).
// The server re-checks every pin with a 400, so this only saves a round trip.
function inRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Parses GeoJSON (FeatureCollection of Polygon/MultiPolygon); null if it holds no polygon. */
export function parseCampusBoundary(geojson: unknown): CampusBoundary | null {
  const features = (geojson as { features?: { geometry?: { type?: string; coordinates?: unknown } }[] })?.features;
  const polygons: Polygon[] = [];
  for (const g of (features ?? []).map((f) => f?.geometry)) {
    if (g?.type === "Polygon") polygons.push(g.coordinates as Polygon);
    else if (g?.type === "MultiPolygon") polygons.push(...(g.coordinates as Polygon[]));
  }
  if (polygons.length === 0) return null;
  const points = polygons.flatMap(([outer]) => outer);
  const lngs = points.map((p) => p[0]);
  const lats = points.map((p) => p[1]);
  return {
    contains: (lat, lng) =>
      polygons.some(([outer, ...holes]) => inRing(lng, lat, outer) && !holes.some((h) => inRing(lng, lat, h))),
    bounds: [
      [Math.min(...lats), Math.min(...lngs)],
      [Math.max(...lats), Math.max(...lngs)],
    ],
  };
}
