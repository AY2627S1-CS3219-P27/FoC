import type { NoticeBuilder } from './notice.js';
import type { Status } from './status.js';

// Projection columns a transition may write; values come from the caller.
export type Col =
  | 'courierId'
  | 'pickedUpAt'
  | 'deliveredAt'
  | 'cancellationReason'
  | 'rewardCredits'
  | 'supplierValidatedAt'
  | 'pickupLocation'
  | 'pickupName'
  | 'pickupDescription'
  | 'settlementAmount'
  | 'settlementNote';

// Who may take an edge. `other` = any user who is not the requester.
// `admin` = a user whose token carries isAdmin; transition() checks the flag, the row check lets them through.
export type UserRole = 'requester' | 'courier' | 'other' | 'admin';
export type Role = UserRole | 'system';

// Closed set of cancellation reasons; each cancel edge allows a subset.
export const CANCELLATION_REASONS = [
  'SUPPLIER_UNAVAILABLE',
  'SUPPLIER_VALIDATION_TIMEOUT',
  'INSUFFICIENT_CREDITS',
  'MISSING_BALANCE',
  'CREDIT_TIMEOUT',
  'ERRAND_EXPIRED',
  'PICKUP_TIME_EXCEEDED',
  'REQUESTER_CANCELLED',
] as const;
export type CancellationReason = (typeof CANCELLATION_REASONS)[number];
// Reasons only a user may give; every other reason is system-only.
export const USER_REASONS: CancellationReason[] = ['REQUESTER_CANCELLED'];

export interface Edge {
  type: string; // event type
  sets: Col[]; // caller must supply exactly these
  clears: Col[]; // transition() nulls these
  who: Role[]; // allowed actors; enforced in the conditional UPDATE
  reasons?: CancellationReason[]; // allowed cancellationReason values
  unexpiredOnly?: true; // refuse once expires_at has passed (F5.5)
  setsExpiry?: true; // expires_at = now + the duration in event 1 (ADR 0007)
  notice?: NoticeBuilder; // outbox notice written in the transition's transaction (ADR 0008)
}

// Release notice for credit; payload is just the errand (agree changes with credit: a change is a v2).
const release: NoticeBuilder = (c) => ({
  key: 'order.errand-cancelled.v1',
  payload: { errandId: c.errandId },
});
const cancel = (
  who: Role[],
  reasons: CancellationReason[],
  notice: NoticeBuilder | null = release,
): Edge => ({
  type: 'ErrandCancelled',
  sets: ['cancellationReason'],
  clears: [],
  who,
  reasons,
  notice: notice ?? undefined,
});
const plain = (type: string, who: Role[], notice?: NoticeBuilder): Edge => ({
  type,
  sets: [],
  clears: [],
  who,
  notice,
});
const sys: Role[] = ['system'];

// 20 edges in total
export const EDGES: Partial<
  Record<Status, Partial<Record<Status, Edge | Edge[]>>>
> = {
  'Pending-Supplier': {
    'Reserving-Credit': {
      ...plain('SupplierValidated', sys, (c) => ({
        key: 'credit.reservation.v1',
        payload: {
          errandId: c.errandId,
          requesterUserId: c.requesterId,
          amount: c.rewardCredits,
        },
      })),
      sets: ['supplierValidatedAt', 'pickupName', 'pickupLocation', 'pickupDescription'],
    },
    // Nothing reserved yet, so nothing to release.
    Cancelled: cancel(sys, ['SUPPLIER_UNAVAILABLE', 'SUPPLIER_VALIDATION_TIMEOUT'], null),
  },
  'Reserving-Credit': {
    Open: { ...plain('CreditReserved', sys), setsExpiry: true },
    // Release only on timeout: a reservation may be in flight (a late success is released again). A rejection reply reserved nothing.
    Cancelled: cancel(
      sys,
      ['INSUFFICIENT_CREDITS', 'MISSING_BALANCE', 'CREDIT_TIMEOUT'],
      (c) => (c.payload.cancellationReason === 'CREDIT_TIMEOUT' ? release(c) : undefined),
    ),
  },
  Open: {
    Accepted: {
      type: 'ErrandAccepted',
      sets: ['courierId'],
      clears: [],
      who: ['other'],
      unexpiredOnly: true,
    },
    // New amount rides in the payload.
    'Adjusting-Credit': plain('AdjustmentRequested', ['requester'], (c) => ({
      key: 'credit.reservation-adjustment.v1',
      payload: {
        errandId: c.errandId,
        oldAmount: c.rewardCredits,
        newAmount: c.payload.newAmount,
      },
    })),
    Cancelled: cancel(['requester', 'system'], ['REQUESTER_CANCELLED', 'ERRAND_EXPIRED']),
  },
  'Adjusting-Credit': {
    Open: [
      { type: 'CreditAdjusted', sets: ['rewardCredits'], clears: [], who: sys },
      plain('CreditAdjustmentFailed', sys),
    ],
  },
  Accepted: {
    'Picked Up': { type: 'ErrandPickedUp', sets: ['pickedUpAt'], clears: [], who: ['courier'] },
    // No Cancelled edge: the requester cannot cancel once accepted; the courier withdraws instead.
    Open: { type: 'CourierWithdrew', sets: [], clears: ['courierId'], who: ['courier'] },
  },
  'Picked Up': {
    Delivered: { type: 'ErrandDelivered', sets: ['deliveredAt'], clears: [], who: ['courier'] },
    // System only (the 24h timer): the requester cannot cancel once picked up.
    Cancelled: cancel(sys, ['PICKUP_TIME_EXCEEDED']),
  },
  Delivered: {
    // System too: the 24h auto-complete (ADR 0007).
    'Transferring-Credit': plain('ErrandConfirmed', ['requester', 'system'], (c) => ({
      key: 'order.errand-completed.v1',
      payload: {
        errandId: c.errandId,
        requesterUserId: c.requesterId,
        courierUserId: c.courierId,
        amount: c.rewardCredits,
      },
    })),
    Incomplete: plain('ErrandIncomplete', ['requester']),
  },
  'Transferring-Credit': {
    Completed: plain('CreditTransferSucceeded', sys),
    // Credit rejected the transfer (terminal on its side too): park in Incomplete for an admin to settle (dispute resolution).
    Incomplete: plain('CreditTransferRejected', sys),
  },
  // Dispute resolution: an admin settles; credit's reply resolves or returns the errand.
  Incomplete: {
    'Settling-Credit': {
      type: 'SettlementRequested',
      sets: ['settlementAmount', 'settlementNote'],
      clears: [],
      who: ['admin'],
      // One atomic credit operation out of the single reservation; attempt counts requests (credit is idempotent on errandId + attempt).
      notice: (c) => {
        const courierAmount = c.payload.settlementAmount as number;
        return {
          key: 'credit.settlement.v1',
          payload: {
            errandId: c.errandId,
            requesterUserId: c.requesterId,
            courierUserId: c.courierId,
            courierAmount,
            requesterAmount: c.rewardCredits - courierAmount,
            attempt: c.attempt,
          },
        };
      },
    },
  },
  'Settling-Credit': {
    Resolved: plain('CreditSettlementSucceeded', sys),
    Incomplete: {
      type: 'CreditSettlementRejected',
      sets: [],
      clears: ['settlementAmount', 'settlementNote'],
      who: sys,
    },
  },
};

export function requesterCanCancel(from: Status): boolean {
  return findEdge(from, 'Cancelled')?.who.includes('requester') ?? false;
}

export function findEdge(
  from: Status,
  to: Status,
  type?: string,
): Edge | undefined {
  const e = EDGES[from]?.[to];
  if (!Array.isArray(e)) return e;
  return type ? e.find((x) => x.type === type) : undefined;
}
