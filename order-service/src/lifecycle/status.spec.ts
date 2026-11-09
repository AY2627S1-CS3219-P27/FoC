import { EDGES, findEdge } from './edges.js';
import {
  ACTIVE_STATUSES,
  ALLOWED,
  STATUSES,
  TERMINAL_STATUS,
  canTransition,
  type Status,
} from './status.js';

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
    expect(
      findEdge('Adjusting-Credit', 'Open', 'CreditAdjusted')?.sets,
    ).toEqual(['rewardCredits']);
    expect(
      findEdge('Adjusting-Credit', 'Open', 'CreditAdjustmentFailed')?.sets,
    ).toEqual([]);
  });

  it('lets the supplier validation write the delivery snapshot and cancel for a missing building', () => {
    expect(findEdge('Pending-Supplier', 'Reserving-Credit')?.sets).toContain('deliveryLocation');
    expect(findEdge('Pending-Supplier', 'Cancelled')?.reasons).toEqual([
      'SUPPLIER_UNAVAILABLE',
      'BUILDING_UNAVAILABLE',
      'SUPPLIER_VALIDATION_TIMEOUT',
    ]);
  });

  it('gives every edge an actor rule and every cancel edge a reason subset', () => {
    const edges = Object.values(EDGES)
      .flatMap((m) => Object.values(m!))
      .flat();
    for (const e of edges) {
      expect(e.who.length).toBeGreaterThan(0);
      expect(!!e.reasons).toBe(e.sets.includes('cancellationReason'));
    }
  });

  it('builds communication notices from persisted participants and the authorized withdrawal actor', () => {
    const context = {
      errandId: '11111111-1111-4111-8111-111111111111',
      requesterId: '22222222-2222-4222-8222-222222222222',
      courierId: '33333333-3333-4333-8333-333333333333',
      actorUserId: '44444444-4444-4444-8444-444444444444',
      rewardCredits: 5,
      attempt: 1,
      payload: {},
    };

    expect(findEdge('Open', 'Accepted')?.notice?.(context)).toEqual({
      key: 'order.errand-accepted.v1',
      payload: {
        errandId: context.errandId,
        requesterUserId: context.requesterId,
        courierUserId: context.courierId,
      },
    });
    expect(findEdge('Picked Up', 'Delivered')?.notice?.(context)).toEqual({
      key: 'order.errand-delivered.v1',
      payload: {
        errandId: context.errandId,
        requesterUserId: context.requesterId,
        courierUserId: context.courierId,
      },
    });
    expect(
      findEdge('Accepted', 'Open')?.notice?.({
        ...context,
        courierId: null,
      }),
    ).toEqual({
      key: 'order.courier-cancelled.v1',
      payload: {
        errandId: context.errandId,
        requesterUserId: context.requesterId,
        courierUserId: context.actorUserId,
      },
    });
  });
  it('tells the requester about a system cancel, alongside the release to credit, but not about their own', () => {
    const ctx = (cancellationReason: string) => ({
      errandId: '11111111-1111-4111-8111-111111111111',
      requesterId: '22222222-2222-4222-8222-222222222222',
      courierId: null,
      actorUserId: null,
      rewardCredits: 5,
      attempt: 1,
      payload: { cancellationReason },
    });
    const keys = (from: Status, reason: string) =>
      [findEdge(from, 'Cancelled')?.notice?.(ctx(reason))]
        .flat()
        .map((n) => n?.key);

    // Nothing reserved: only the requester notice.
    expect(keys('Pending-Supplier', 'SUPPLIER_VALIDATION_TIMEOUT')).toEqual([
      'order.requester-errand-cancelled.v1',
    ]);
    // A timeout may leave a reservation behind, so credit gets a release too.
    expect(keys('Reserving-Credit', 'CREDIT_TIMEOUT')).toEqual([
      'order.errand-cancelled.v1',
      'order.requester-errand-cancelled.v1',
    ]);
    // The requester's own cancel: release only.
    expect(keys('Open', 'REQUESTER_CANCELLED')).toEqual(['order.errand-cancelled.v1']);
  });
});
