import { EDGES } from './edges.js';
import { ALLOWED, STATUSES, canTransition } from './status.js';

describe('status transitions', () => {
  for (const from of STATUSES) {
    for (const to of STATUSES) {
      const ok = ALLOWED[from].includes(to);
      it(`${from} -> ${to} ${ok ? 'allowed' : 'rejected'}`, () => {
        expect(canTransition(from, to)).toBe(ok);
      });
    }
  }

  it('has exactly the 13 distinct documented edges (items 6 and 7 share Open -> Cancelled)', () => {
    expect(Object.values(ALLOWED).flat()).toHaveLength(13);
  });
});

describe('EDGES', () => {
  it('mirrors ALLOWED exactly', () => {
    for (const from of STATUSES) {
      expect(Object.keys(EDGES[from] ?? {}).sort()).toEqual(
        [...ALLOWED[from]].sort(),
      );
    }
  });
});
