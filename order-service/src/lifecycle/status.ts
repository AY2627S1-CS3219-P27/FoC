import { pgEnum } from 'drizzle-orm/pg-core';

export const STATUSES = [
  'Pending-Supplier',
  'Reserving-Credit',
  'Open',
  'Accepted',
  'Picked Up',
  'Delivered',
  'Transferring-Credit',
  'Adjusting-Credit',
  'Completed',
  'Cancelled',
  'Incomplete',
] as const;

export type Status = (typeof STATUSES)[number];

export const statusEnum = pgEnum('errand_status', STATUSES);

// ARCHITECTURE.md §2 (F9.4). Terminal states map to [].
export const ALLOWED: Record<Status, Status[]> = {
  'Pending-Supplier': ['Reserving-Credit', 'Cancelled'],
  'Reserving-Credit': ['Open', 'Cancelled'],
  'Open': ['Accepted', 'Adjusting-Credit', 'Cancelled'],
  'Adjusting-Credit': ['Open'],
  'Accepted': ['Picked Up', 'Open', 'Cancelled'],
  'Picked Up': ['Delivered', 'Cancelled'],
  'Delivered': ['Transferring-Credit', 'Incomplete'],
  'Transferring-Credit': ['Completed', 'Delivered'],
  'Completed': [],
  'Cancelled': [],
  'Incomplete': [],
};

// A courier holds at most one errand in these statuses (L5); the partial
// unique index in schema.ts is built from this.
export const ACTIVE_STATUSES: Status[] = ['Accepted', 'Picked Up'];

export const canTransition = (from: Status, to: Status): boolean =>
  ALLOWED[from].includes(to);
