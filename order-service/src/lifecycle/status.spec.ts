import { EDGES, findEdge } from './edges.js';
import { ACTIVE_STATUSES, ALLOWED, STATUSES, TERMINAL_STATUS, canTransition } from './status.js';

describe('status transitions', () => {
  for (const from of STATUSES) {
    for (const to of STATUSES) {
      const ok = ALLOWED[from].includes(to);
      it(`${from} -> ${to} ${ok ? 'allowed' : 'rejected'}`, () => {
        expect(canTransition(from, to)).toBe(ok);
      });
    }
  }

  // 20 edges (ADR 0006, dispute resolution); the two Adjusting-Credit -> Open exits share one pair.
  it('has exactly 19 distinct status pairs', () => {
    expect(Object.values(ALLOWED).flat()).toHaveLength(19);
  });
});

// The courier-lock index (schema.ts) is built from this; a change must be deliberate.
it('treats Accepted and Picked Up as the active statuses', () => {
  expect(ACTIVE_STATUSES).toEqual(['Accepted', 'Picked Up']);
});

// Incomplete is no longer terminal (an admin can settle it); role blocks read this list.
it('treats Completed, Cancelled and Resolved as the terminal statuses', () => {
  expect(TERMINAL_STATUS).toEqual(['Completed', 'Cancelled', 'Resolved']);
  for (const s of TERMINAL_STATUS) expect(ALLOWED[s]).toEqual([]);
});

describe('EDGES', () => {
  it('mirrors ALLOWED exactly', () => {
    for (const from of STATUSES) {
      expect(Object.keys(EDGES[from] ?? {}).sort()).toEqual(
        [...ALLOWED[from]].sort(),
      );
    }
  });

  it('has 20 edges; only Adjusting-Credit -> Open has two', () => {
    const edges = Object.values(EDGES).flatMap((m) => Object.values(m!)).flat();
    expect(edges).toHaveLength(20);
    expect(findEdge('Adjusting-Credit', 'Open')).toBeUndefined(); // ambiguous without a type
    expect(findEdge('Adjusting-Credit', 'Open', 'CreditAdjusted')?.sets).toEqual(['rewardCredits']);
    expect(findEdge('Adjusting-Credit', 'Open', 'CreditAdjustmentFailed')?.sets).toEqual([]);
  });

  it('gives every edge an actor rule and every cancel edge a reason subset', () => {
    const edges = Object.values(EDGES).flatMap((m) => Object.values(m!)).flat();
    for (const e of edges) {
      expect(e.who.length).toBeGreaterThan(0);
      expect(!!e.reasons).toBe(e.sets.includes('cancellationReason'));
    }
  });
});
