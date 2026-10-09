import type { Status } from './status.js';

// Projection columns a transition may write; values come from the caller.
export type Col =
  | 'courierId'
  | 'pickedUpAt'
  | 'deliveredAt'
  | 'cancellationReason'
  | 'rewardCredits';

// Who may take an edge (L4). `other` = any user who is not the requester.
export type UserRole = 'requester' | 'courier' | 'other';
export type Role = UserRole | 'system';

// Closed set of cancellation reasons (L7); each cancel edge allows a subset.
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

export interface Edge {
  type: string; // event type
  sets: Col[]; // caller must supply exactly these
  clears: Col[]; // transition() nulls these
  who: Role[]; // allowed actors; enforced in the conditional UPDATE
  reasons?: CancellationReason[]; // allowed cancellationReason values
  unexpiredOnly?: true; // refuse once expires_at has passed (F5.5)
}

const cancel = (who: Role[], reasons: CancellationReason[]): Edge => ({
  type: 'ErrandCancelled',
  sets: ['cancellationReason'],
  clears: [],
  who,
  reasons,
});
const plain = (type: string, who: Role[]): Edge => ({
  type,
  sets: [],
  clears: [],
  who,
});
const sys: Role[] = ['system'];

// The 18 edges of ARCHITECTURE.md §2 (ADR 0006); must mirror ALLOWED in
// status.ts. A pair with several exits holds an array, picked by event type.
export const EDGES: Partial<
  Record<Status, Partial<Record<Status, Edge | Edge[]>>>
> = {
  'Pending-Supplier': {
    'Reserving-Credit': plain('SupplierValidated', sys),
    Cancelled: cancel(sys, ['SUPPLIER_UNAVAILABLE', 'SUPPLIER_VALIDATION_TIMEOUT']),
  },
  'Reserving-Credit': {
    Open: plain('CreditReserved', sys),
    Cancelled: cancel(sys, ['INSUFFICIENT_CREDITS', 'MISSING_BALANCE', 'CREDIT_TIMEOUT']),
  },
  Open: {
    Accepted: {
      type: 'ErrandAccepted',
      sets: ['courierId'],
      clears: [],
      who: ['other'],
      unexpiredOnly: true,
    },
    'Adjusting-Credit': plain('AdjustmentRequested', ['requester']), // new amount rides in the payload
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
    Open: { type: 'CourierWithdrew', sets: [], clears: ['courierId'], who: ['courier'] },
    // "If permitted" (F9.4 item 10): rule unspecified, requester or system for now.
    Cancelled: cancel(['requester', 'system'], ['REQUESTER_CANCELLED']),
  },
  'Picked Up': {
    Delivered: { type: 'ErrandDelivered', sets: ['deliveredAt'], clears: [], who: ['courier'] },
    Cancelled: cancel(['requester', 'system'], ['REQUESTER_CANCELLED', 'PICKUP_TIME_EXCEEDED']),
  },
  Delivered: {
    // System too: the 24h auto-complete (D3).
    'Transferring-Credit': plain('ErrandConfirmed', ['requester', 'system']),
    Incomplete: plain('ErrandIncomplete', ['requester']),
  },
  'Transferring-Credit': {
    Completed: plain('ErrandCompleted', sys),
    Delivered: plain('CreditTransferFailed', sys),
  },
};

// `type` is only needed for a pair with several exits; without it such a pair
// is ambiguous and resolves to undefined.
export function findEdge(
  from: Status,
  to: Status,
  type?: string,
): Edge | undefined {
  const e = EDGES[from]?.[to];
  if (!Array.isArray(e)) return e;
  return type ? e.find((x) => x.type === type) : undefined;
}
