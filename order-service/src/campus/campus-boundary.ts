type Ring = number[][]; // [lng, lat] pairs, GeoJSON order
type Polygon = Ring[]; // outer ring, then holes

const onSegment = (px: number, py: number, [ax, ay]: number[], [bx, by]: number[]) =>
  (bx - ax) * (py - ay) === (by - ay) * (px - ax) &&
  px >= Math.min(ax, bx) && px <= Math.max(ax, bx) &&
  py >= Math.min(ay, by) && py <= Math.max(ay, by);

export type CampusContains = (latitude: number, longitude: number) => boolean;

// Ray casting. Boundary points count as outside (checked first, since the ray cast is unreliable on edges).
function inRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    if (onSegment(x, y, ring[j], ring[i])) return false;
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const inPolygon = (x: number, y: number, [outer, ...holes]: Polygon) =>
  inRing(x, y, outer) && !holes.some((h) => inRing(x, y, h));

// Takes parsed GeoJSON (FeatureCollection of Polygon/MultiPolygon) and returns (latitude, longitude) => inside campus.
export function parseCampusBoundary(geojson: any): CampusContains {
  const polygons: Polygon[] = [];
  for (const f of geojson?.features ?? []) {
    const g = f?.geometry;
    if (g?.type === 'Polygon') polygons.push(g.coordinates);
    else if (g?.type === 'MultiPolygon') polygons.push(...g.coordinates);
  }
  if (polygons.length === 0) throw new Error('Campus boundary has no Polygon or MultiPolygon');
  return (latitude, longitude) => polygons.some((p) => inPolygon(longitude, latitude, p));
}
