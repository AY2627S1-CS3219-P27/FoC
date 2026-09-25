import type { Status } from './status.js';

// Projection columns a transition may write; values come from the caller.
export type Col =
  'courierId' | 'pickedUpAt' | 'deliveredAt' | 'cancellationReason';

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

// The 13 edges of ARCHITECTURE.md §2; must mirror ALLOWED in status.ts.
export const EDGES: Partial<Record<Status, Partial<Record<Status, Edge>>>> = {
  'Pending-Supplier': {
    'Pending-Credit': plain('SupplierValidated'),
    'Cancelled': cancel,
  },
  'Pending-Credit': { Open: plain('CreditReserved'), Cancelled: cancel },
  'Open': {
    'Accepted': { type: 'ErrandAccepted', sets: ['courierId'], clears: [] },
    'Cancelled': cancel,
  },
  'Accepted': {
    'Picked Up': { type: 'ErrandPickedUp', sets: ['pickedUpAt'], clears: [] },
    'Open': { type: 'CourierWithdrew', sets: [], clears: ['courierId'] },
    'Cancelled': cancel,
  },
  'Picked Up': {
    'Delivered': { type: 'ErrandDelivered', sets: ['deliveredAt'], clears: [] },
    'Cancelled': cancel,
  },
  'Delivered': {
    'Completed': plain('ErrandCompleted'),
    'Incomplete': plain('ErrandIncomplete'),
  },
};
