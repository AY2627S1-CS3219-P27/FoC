import { canonicalJson, hashCanonicalJson } from './canonical-json.js';

describe('canonical JSON evidence', () => {
  it('sorts object keys recursively while preserving array order', () => {
    const left = {
      z: [{ b: 2, a: 1 }],
      a: { y: true, x: null },
    };
    const right = {
      a: { x: null, y: true },
      z: [{ a: 1, b: 2 }],
    };

    expect(canonicalJson(left)).toBe(
      '{"a":{"x":null,"y":true},"z":[{"a":1,"b":2}]}',
    );
    expect(hashCanonicalJson(left)).toBe(hashCanonicalJson(right));
    expect(hashCanonicalJson([1, 2])).not.toBe(hashCanonicalJson([2, 1]));
  });

  it('includes envelope evidence, not only the business payload', () => {
    const event = {
      eventId: '98f5905c-2cd6-4e4c-b3d2-eaa87440af87',
      eventType: 'ErrandAccepted',
      timestamp: '2026-11-04T00:00:00.000Z',
      publisher: 'order-service',
      payload: { errandId: '2062212e-3a39-4a7c-b9bb-d1e743618b61' },
    };
    expect(hashCanonicalJson(event)).not.toBe(
      hashCanonicalJson({ ...event, timestamp: '2026-11-04T00:00:01.000Z' }),
    );
  });

  it('rejects values outside validated JSON', () => {
    expect(() => canonicalJson(Number.NaN)).toThrow('non-finite');
    expect(() => canonicalJson(new Date())).toThrow('plain objects');
    expect(() => canonicalJson(undefined)).toThrow('undefined');
  });
});
