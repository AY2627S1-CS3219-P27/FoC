import {
  ORDER_COURIER_CANCELLED_V1_ROUTING_KEY,
  ORDER_ERRAND_ACCEPTED_V1_ROUTING_KEY,
  ORDER_ERRAND_DELIVERED_V1_ROUTING_KEY,
  ORDER_REQUESTER_ERRAND_CANCELLED_V1_ROUTING_KEY,
} from '@foc/contracts';
import { supplierRequest, supplierRevalidationId, type NoticeBuilder, type Notice } from './notice.js';
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
  | 'deliveryLocation'
  | 'deliveryVenueId'
  | 'deliveryVenue'
  | 'deliveryLatitude'
  | 'deliveryLongitude'
  | 'settlementAmount'
  | 'settlementNote'
  | 'description'
  | 'deliveryDetail'
  | 'collectionItems'
  | 'supplierId'
  | 'deliveryBuildingId'
  | 'pendingSupplierId'
  | 'pendingDeliveryBuildingId'
  | 'expiresAt';

// F2.1: create fields a requester may change on an Open errand without asking another service.
export const EDITABLE: Col[] = ['description', 'deliveryDetail', 'collectionItems'];

// Who may take an edge. `other` = any user who is not the requester.
// `admin` = a user whose token carries isAdmin; transition() checks the flag, the row check lets them through.
export type UserRole = 'requester' | 'courier' | 'other' | 'admin';
export type Role = UserRole | 'system';

// The event that locks dispute reports; reports.service reads it.
export const SETTLEMENT_REQUESTED = 'SettlementRequested';
export const CREDIT_SETTLEMENT_REJECTED = 'CreditSettlementRejected';
export const CREDIT_TRANSFER_REJECTED = 'CreditTransferRejected';

// Closed set of cancellation reasons; each cancel edge allows a subset.
export const CANCELLATION_REASONS = [
  'SUPPLIER_UNAVAILABLE',
  'BUILDING_UNAVAILABLE',
  'VENUE_UNAVAILABLE',
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
  optional?: Col[]; // caller may also supply these; an in-place edge needs at least one change
  clears: Col[]; // transition() nulls these
  who: Role[]; // allowed actors; enforced in the conditional UPDATE
  reasons?: CancellationReason[]; // allowed cancellationReason values
  unexpiredOnly?: true; // refuse once expires_at has passed (F5.5)
  setsExpiry?: true; // expires_at = now + the duration in event 1 (ADR 0007)
  editsExpiry?: true; // payload expiryDurationMinutes: expires_at = opened-at + it, must be in the future
  notice?: NoticeBuilder; // outbox notice written in the transition's transaction (ADR 0008)
  snapshots?: true; // event records `previous`: the local fields as they stood before this edit
  restores?: true; // refused edit: local fields go back to the latest `previous` in the log
}

// Release notice for credit; payload is just the errand (agree changes with credit: a change is a v2).
const release: NoticeBuilder = (c) => ({
  key: 'order.errand-cancelled.v1',
  payload: { errandId: c.errandId },
});
const accepted: NoticeBuilder = (c) => ({
  key: ORDER_ERRAND_ACCEPTED_V1_ROUTING_KEY,
  payload: {
    errandId: c.errandId,
    requesterUserId: c.requesterId,
    courierUserId: c.courierId,
  },
});
const delivered: NoticeBuilder = (c) => ({
  key: ORDER_ERRAND_DELIVERED_V1_ROUTING_KEY,
  payload: {
    errandId: c.errandId,
    requesterUserId: c.requesterId,
    courierUserId: c.courierId,
  },
});
const courierCancelled: NoticeBuilder = (c) => ({
  key: ORDER_COURIER_CANCELLED_V1_ROUTING_KEY,
  payload: {
    errandId: c.errandId,
    requesterUserId: c.requesterId,
    courierUserId: c.actorUserId,
  },
});
// Tells the requester why the system cancelled; their own cancel needs no notice.
const requesterCancelled: NoticeBuilder = (c) =>
  USER_REASONS.includes(c.payload.cancellationReason as CancellationReason)
    ? undefined
    : {
        key: ORDER_REQUESTER_ERRAND_CANCELLED_V1_ROUTING_KEY,
        payload: {
          errandId: c.errandId,
          requesterUserId: c.requesterId,
          cancellationReason: c.payload.cancellationReason,
        },
      };
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
  notice: (c) =>
    [notice?.(c), requesterCancelled(c)].flat().filter((n): n is Notice => !!n),
});
const plain = (type: string, who: Role[], notice?: NoticeBuilder): Edge => ({
  type,
  sets: [],
  clears: [],
  who,
  notice,
});
const sys: Role[] = ['system'];
// F2: requester edits on an Open errand; refused once it has expired.
const editable = { optional: EDITABLE, editsExpiry: true, unexpiredOnly: true } as const;
const PENDING: Col[] = ['pendingSupplierId', 'pendingDeliveryBuildingId'];
// Supplier columns a chained edit applies once credit has agreed.
const CONFIRMED: Col[] = [
  'supplierId',
  'deliveryBuildingId',
  'supplierValidatedAt',
  'pickupName',
  'pickupLocation',
  'pickupDescription',
  'deliveryLocation',
  'deliveryVenueId',
  'deliveryVenue',
  'deliveryLatitude',
  'deliveryLongitude',
];
// Attempt 0 here; the resend sweep re-creates this id and counts on from it.
const revalidation: NoticeBuilder = (c) => ({
  ...supplierRequest(
    c.errandId,
    c.payload.pendingSupplierId as string,
    c.payload.pendingDeliveryBuildingId as string,
  ),
  eventId: supplierRevalidationId(c.errandId, c.sequenceNumber, 0),
});

// 27 edges in total
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
      sets: [
        'supplierValidatedAt',
        'pickupName',
        'pickupLocation',
        'pickupDescription',
        'deliveryLocation',
        'deliveryVenue',
        'deliveryLatitude',
        'deliveryLongitude',
      ],
    },
    // Nothing reserved yet, so nothing to release.
    Cancelled: cancel(
      sys,
      ['SUPPLIER_UNAVAILABLE', 'BUILDING_UNAVAILABLE', 'VENUE_UNAVAILABLE', 'SUPPLIER_VALIDATION_TIMEOUT'],
      null,
    ),
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
      notice: accepted,
    },
    // New amount rides in the payload; an edit may change local fields in the same step.
    'Adjusting-Credit': {
      ...plain('AdjustmentRequested', ['requester'], (c) => ({
        key: 'credit.reservation-adjustment.v1',
        payload: {
          errandId: c.errandId,
          oldAmount: c.rewardCredits,
          newAmount: c.payload.newAmount,
        },
      })),
      ...editable,
      snapshots: true,
    },
    // F2.1: fields that need no other service change in place.
    Open: { ...plain('ErrandEdited', ['requester']), ...editable },
    // F2.1.1: a new supplier or building is re-checked first; the errand keeps the old ones meanwhile.
    'Revalidating-Supplier': {
      ...plain('SupplierRevalidationRequested', ['requester'], revalidation),
      sets: PENDING,
      ...editable,
      snapshots: true,
    },
    // Reward and supplier in one edit: supplier first, then credit (ADR 0014 follow-up).
    Editing: {
      ...plain('EditRequested', ['requester'], revalidation),
      sets: PENDING,
      ...editable,
      snapshots: true,
    },
    Cancelled: cancel(['requester', 'system'], ['REQUESTER_CANCELLED', 'ERRAND_EXPIRED']),
  },
  // Supplier confirmed: hold its answer in the event and ask credit. Nothing is applied until credit agrees.
  Editing: {
    'Adjusting-Credit': {
      ...plain('SupplierConfirmed', sys, (c) => ({
        key: 'credit.reservation-adjustment.v1',
        payload: {
          errandId: c.errandId,
          oldAmount: c.rewardCredits,
          newAmount: c.payload.newAmount,
        },
      })),
      clears: PENDING,
    },
    // Supplier refused or did not answer: the old supplier stays and the local fields go back.
    Open: { ...plain('EditFailed', sys), clears: PENDING, restores: true },
  },
  'Adjusting-Credit': {
    Open: [
      // After SupplierConfirmed the supplier columns land together with the reward.
      { type: 'CreditAdjusted', sets: ['rewardCredits'], optional: CONFIRMED, clears: [], who: sys },
      { ...plain('CreditAdjustmentFailed', sys), restores: true },
    ],
  },
  // Supplier-service's answer (or the hold sweep) settles the edit; a refusal keeps the old supplier.
  'Revalidating-Supplier': {
    Open: [
      {
        type: 'SupplierRevalidated',
        sets: [
          'supplierId',
          'deliveryBuildingId',
          'supplierValidatedAt',
          'pickupName',
          'pickupLocation',
          'pickupDescription',
          'deliveryLocation',
        ],
        // Only a new building moves the delivery point.
        optional: ['deliveryVenueId', 'deliveryVenue', 'deliveryLatitude', 'deliveryLongitude'],
        clears: PENDING,
        who: sys,
      },
      { type: 'SupplierRevalidationFailed', sets: [], clears: PENDING, who: sys, restores: true },
    ],
  },
  Accepted: {
    'Picked Up': { type: 'ErrandPickedUp', sets: ['pickedUpAt'], clears: [], who: ['courier'] },
    // No Cancelled edge: the requester cannot cancel once accepted; the courier withdraws instead.
    Open: { type: 'CourierWithdrew', sets: [], clears: ['courierId'], who: ['courier'], notice: courierCancelled },
  },
  'Picked Up': {
    Delivered: { type: 'ErrandDelivered', sets: ['deliveredAt'], clears: [], who: ['courier'], notice: delivered },
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
      type: SETTLEMENT_REQUESTED,
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
      type: CREDIT_SETTLEMENT_REJECTED,
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
