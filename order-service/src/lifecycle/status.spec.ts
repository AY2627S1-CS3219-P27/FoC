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

  // 27 edges (ADR 0006, dispute resolution, F2 edit, chained edit); the Adjusting-Credit and
  // Revalidating-Supplier -> Open exits each share one pair.
  it('has exactly 25 distinct status pairs', () => {
    expect(Object.values(ALLOWED).flat()).toHaveLength(25);
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

  it('lets only the requester edit an Open errand in place, before it expires (F2)', () => {
    expect(findEdge('Open', 'Open')).toMatchObject({
      type: 'ErrandEdited',
      sets: [],
      optional: ['description', 'deliveryDetail', 'collectionItems'],
      who: ['requester'],
      editsExpiry: true,
      unexpiredOnly: true,
    });
  });

  it('re-checks a new supplier or building before switching to it (F2.1.1)', () => {
    expect(findEdge('Open', 'Revalidating-Supplier')).toMatchObject({
      type: 'SupplierRevalidationRequested',
      sets: ['pendingSupplierId', 'pendingDeliveryBuildingId'],
      who: ['requester'],
      unexpiredOnly: true,
    });
    expect(findEdge('Revalidating-Supplier', 'Open')).toBeUndefined(); // ambiguous without a type
    const done = findEdge('Revalidating-Supplier', 'Open', 'SupplierRevalidated');
    expect(done?.sets).toEqual(expect.arrayContaining(['supplierId', 'deliveryBuildingId', 'pickupName', 'deliveryLocation']));
    expect(done?.clears).toEqual(['pendingSupplierId', 'pendingDeliveryBuildingId']);
    expect(findEdge('Revalidating-Supplier', 'Open', 'SupplierRevalidationFailed')).toMatchObject({
      sets: [],
      clears: ['pendingSupplierId', 'pendingDeliveryBuildingId'],
      who: ['system'],
    });
  });

  it('asks supplier-service about the pending ids, under an id tied to the edit', () => {
    const c = {
      errandId: '11111111-1111-4111-8111-111111111111',
      requesterId: '22222222-2222-4222-8222-222222222222',
      courierId: null,
      actorUserId: '22222222-2222-4222-8222-222222222222',
      rewardCredits: 5,
      settlementAmount: null,
      settlementNote: null,
      payload: {
        pendingSupplierId: '33333333-3333-4333-8333-333333333333',
        pendingDeliveryBuildingId: '44444444-4444-4444-8444-444444444444',
      },
      attempt: 1,
      sequenceNumber: 7,
    };
    const notice = findEdge('Open', 'Revalidating-Supplier')?.notice?.(c);
    expect(notice).toEqual({
      key: 'order.supplier-validation-requested.v1',
      payload: {
        errandId: c.errandId,
        supplierId: c.payload.pendingSupplierId,
        deliveryBuildingId: c.payload.pendingDeliveryBuildingId,
      },
      eventId: expect.any(String),
    });
    const again = findEdge('Open', 'Revalidating-Supplier')?.notice?.({ ...c, sequenceNumber: 8 });
    expect(again?.eventId).not.toBe(notice?.eventId);
  });

  it('has 27 edges; only the Adjusting-Credit and Revalidating-Supplier -> Open pairs have two', () => {
    const edges = Object.values(EDGES).flatMap((m) => Object.values(m!)).flat();
    expect(edges).toHaveLength(27);
    for (const [from, tos] of Object.entries(EDGES)) {
      for (const [to, e] of Object.entries(tos!)) {
        expect(Array.isArray(e)).toBe(to === 'Open' && ['Adjusting-Credit', 'Revalidating-Supplier'].includes(from));
      }
    }
    expect(findEdge('Adjusting-Credit', 'Open')).toBeUndefined(); // ambiguous without a type
    expect(
      findEdge('Adjusting-Credit', 'Open', 'CreditAdjusted')?.sets,
    ).toEqual(['rewardCredits']);
    expect(
      findEdge('Adjusting-Credit', 'Open', 'CreditAdjustmentFailed')?.sets,
    ).toEqual([]);
  });

  it('lets the supplier validation write the delivery snapshot and cancel for a missing building or venue', () => {
    expect(findEdge('Pending-Supplier', 'Reserving-Credit')?.sets).toEqual(
      expect.arrayContaining(['deliveryLocation', 'deliveryVenue', 'deliveryLatitude', 'deliveryLongitude']),
    );
    expect(findEdge('Pending-Supplier', 'Cancelled')?.reasons).toEqual([
      'SUPPLIER_UNAVAILABLE',
      'BUILDING_UNAVAILABLE',
      'VENUE_UNAVAILABLE',
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
      settlementAmount: null,
      settlementNote: null,
      attempt: 1,
      payload: {},
      attempt: 1,
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
      settlementAmount: null,
      settlementNote: null,
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

describe('errand-update notices', () => {
  const ctx = (settlementAmount: number | null, settlementNote: string | null) => ({
    errandId: '11111111-1111-4111-8111-111111111111',
    requesterId: '22222222-2222-4222-8222-222222222222',
    courierId: '33333333-3333-4333-8333-333333333333',
    actorUserId: null,
    rewardCredits: 10,
    settlementAmount,
    settlementNote,
    payload: {},
    attempt: 1,
    sequenceNumber: 5,
  });
  const kind = (from: Status, to: Status, type?: string) =>
    (findEdge(from, to, type)?.notice?.(ctx(4, 'n')) as { payload: { kind: string } }).payload.kind;

  it('notifies on pickup, system pickup-cancel, incomplete, transfer outcome and resolution', () => {
    expect(kind('Accepted', 'Picked Up')).toBe('PICKED_UP');
    expect(kind('Delivered', 'Incomplete')).toBe('MARKED_INCOMPLETE');
    expect(kind('Transferring-Credit', 'Completed')).toBe('TRANSFER_SETTLED');
    expect(kind('Transferring-Credit', 'Incomplete')).toBe('TRANSFER_FAILED');
    expect(kind('Settling-Credit', 'Resolved')).toBe('DISPUTE_RESOLVED');
    const cancel = [findEdge('Picked Up', 'Cancelled')?.notice?.({ ...ctx(null, null), payload: { cancellationReason: 'PICKUP_TIME_EXCEEDED' } })].flat();
    expect(cancel.map((n) => (n?.payload as { kind?: string }).kind)).toContain('CANCELLED');
  });

  it('puts the admin split and note on the resolution', () => {
    const n = findEdge('Settling-Credit', 'Resolved')?.notice?.(ctx(4, 'fair')) as { payload: object };
    expect(n.payload).toMatchObject({ courierAmount: 4, requesterAmount: 6, note: 'fair' });
  });

  it('skips the update when the errand has no courier (the schema requires its UUID)', () => {
    const none = { ...ctx(null, null), courierId: null };
    expect(findEdge('Accepted', 'Picked Up')?.notice?.(none)).toBeUndefined();
    // A composed cancel keeps its other notices and drops only the courier's update.
    const cancel = [findEdge('Picked Up', 'Cancelled')?.notice?.({ ...none, payload: { cancellationReason: 'PICKUP_TIME_EXCEEDED' } })].flat();
    expect(cancel.map((n) => (n?.payload as { kind?: string }).kind)).not.toContain('CANCELLED');
    expect(cancel).toHaveLength(2); // the release to credit and the requester's own notice
  });
});
