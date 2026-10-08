import type { Status } from './status.js';

// Projection columns a transition may write; values come from the caller.
export type Col =
  | 'courierId'
  | 'pickedUpAt'
  | 'deliveredAt'
  | 'cancellationReason'
  | 'rewardCredits';

export interface Edge {
  type: string; // event type
  sets: Col[]; // caller must supply exactly these
  clears: Col[]; // transition() nulls these
}

const cancel: Edge = {
  type: 'ErrandCancelled',
  sets: ['cancellationReason'],
  clears: [],
};
const plain = (type: string): Edge => ({ type, sets: [], clears: [] });

// The 18 edges of ARCHITECTURE.md §2 (ADR 0006); must mirror ALLOWED in
// status.ts. A pair with several exits holds an array, picked by event type.
export const EDGES: Partial<
  Record<Status, Partial<Record<Status, Edge | Edge[]>>>
> = {
  'Pending-Supplier': {
    'Reserving-Credit': plain('SupplierValidated'),
    Cancelled: cancel,
  },
  'Reserving-Credit': { Open: plain('CreditReserved'), Cancelled: cancel },
  Open: {
    Accepted: { type: 'ErrandAccepted', sets: ['courierId'], clears: [] },
    'Adjusting-Credit': plain('AdjustmentRequested'), // new amount rides in the payload
    Cancelled: cancel,
  },
  'Adjusting-Credit': {
    Open: [
      { type: 'CreditAdjusted', sets: ['rewardCredits'], clears: [] },
      plain('CreditAdjustmentFailed'),
    ],
  },
  Accepted: {
    'Picked Up': { type: 'ErrandPickedUp', sets: ['pickedUpAt'], clears: [] },
    Open: { type: 'CourierWithdrew', sets: [], clears: ['courierId'] },
    Cancelled: cancel,
  },
  'Picked Up': {
    Delivered: { type: 'ErrandDelivered', sets: ['deliveredAt'], clears: [] },
    Cancelled: cancel,
  },
  Delivered: {
    'Transferring-Credit': plain('ErrandConfirmed'),
    Incomplete: plain('ErrandIncomplete'),
  },
  'Transferring-Credit': {
    Completed: plain('ErrandCompleted'),
    Delivered: plain('CreditTransferFailed'),
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
