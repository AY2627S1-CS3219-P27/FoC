import { canonicalJson, requestFingerprint } from './fingerprint.js';

const parts = {
  method: 'POST',
  path: '/suppliers',
  body: {
    name: 'Cool Spot',
    coordinates: { latitude: 1.29, longitude: 103.77 },
  },
};

describe('canonicalJson', () => {
  it('sorts object keys at every level', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
      '{"a":{"c":3,"d":2},"b":1}',
    );
  });

  it('keeps array order and handles scalars and null', () => {
    expect(canonicalJson([3, 1, { b: 1, a: 2 }])).toBe('[3,1,{"a":2,"b":1}]');
    expect(canonicalJson('x')).toBe('"x"');
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson(undefined)).toBe('null');
  });
});

describe('requestFingerprint (F14.2.1, F14.2.2)', () => {
  it('is a 64-character hex digest, the same for the same request', () => {
    const first = requestFingerprint(parts);

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(requestFingerprint({ ...parts })).toBe(first);
  });

  it('ignores the order of body keys', () => {
    const reordered = {
      ...parts,
      body: {
        coordinates: { longitude: 103.77, latitude: 1.29 },
        name: 'Cool Spot',
      },
    };

    expect(requestFingerprint(reordered)).toBe(requestFingerprint(parts));
  });

  it('ignores the case of the method name', () => {
    expect(requestFingerprint({ ...parts, method: 'post' })).toBe(
      requestFingerprint(parts),
    );
  });

  it.each([
    ['a different value', { body: { ...parts.body, name: 'Other' } }],
    ['an extra field', { body: { ...parts.body, kind: 'Store' } }],
    ['a different path', { path: '/categories' }],
    ['a different method', { method: 'PATCH' }],
    ['an If-Match', { ifMatch: '"1"' }],
    ['no body', { body: undefined }],
  ])('differs for %s', (_, change) => {
    expect(requestFingerprint({ ...parts, ...change })).not.toBe(
      requestFingerprint(parts),
    );
  });

  it('tells an absent If-Match from a different one', () => {
    expect(requestFingerprint({ ...parts, ifMatch: '"1"' })).not.toBe(
      requestFingerprint({ ...parts, ifMatch: '"2"' }),
    );
  });
});
