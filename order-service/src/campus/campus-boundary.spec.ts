import { readFileSync } from 'node:fs';
import { parseCampusBoundary } from './campus-boundary.js';

const square = (ring: number[][]) => ({
  type: 'FeatureCollection',
  features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] } }],
});
// lng/lat order, 0..10 square
const outer = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];

describe('parseCampusBoundary', () => {
  const inside = parseCampusBoundary(square(outer));

  it('contains inner points and rejects outer ones (latitude, longitude args)', () => {
    expect(inside(5, 5)).toBe(true);
    expect(inside(5, 11)).toBe(false);
    expect(inside(-1, 5)).toBe(false);
  });

  it('treats the edge and a vertex as inside', () => {
    expect(inside(0, 5)).toBe(true);
    expect(inside(5, 10)).toBe(true);
    expect(inside(10, 10)).toBe(true);
  });

  it('keeps lat and lng the right way round', () => {
    const wide = parseCampusBoundary(square([[0, 0], [20, 0], [20, 10], [0, 10], [0, 0]]));
    expect(wide(5, 15)).toBe(true); // lat 5, lng 15
    expect(wide(15, 5)).toBe(false);
  });

  it('excludes a hole', () => {
    const holed = parseCampusBoundary({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [outer, [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]] },
      }],
    });
    expect(holed(5, 5)).toBe(false);
    expect(holed(2, 2)).toBe(true);
  });

  it('accepts a MultiPolygon', () => {
    const multi = parseCampusBoundary({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'MultiPolygon', coordinates: [[outer], [[[20, 20], [30, 20], [30, 30], [20, 30], [20, 20]]]] },
      }],
    });
    expect(multi(25, 25)).toBe(true);
    expect(multi(15, 15)).toBe(false);
  });

  it('rejects a file with no polygon', () => {
    expect(() => parseCampusBoundary({ type: 'FeatureCollection', features: [] })).toThrow();
  });

  it('works on the real campus file', () => {
    const real = parseCampusBoundary(
      JSON.parse(readFileSync(new URL('../../../data/json/campus-boundary.geojson', import.meta.url), 'utf8')),
    );
    expect(real(1.2966, 103.7764)).toBe(true); // central campus
    expect(real(1.35, 103.82)).toBe(false);
  });
});
