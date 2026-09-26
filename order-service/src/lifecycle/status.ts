import { pgEnum } from 'drizzle-orm/pg-core';

export const STATUSES = [
  'Pending-Supplier',
  'Pending-Credit',
  'Open',
  'Accepted',
  'Picked Up',
  'Delivered',
  'Completed',
  'Cancelled',
  'Incomplete',
] as const;

export type Status = (typeof STATUSES)[number];

export const statusEnum = pgEnum('errand_status', STATUSES);

// ARCHITECTURE.md §2 (F9.4). Terminal states map to [].
export const ALLOWED: Record<Status, Status[]> = {
  'Pending-Supplier': ['Pending-Credit', 'Cancelled'],
  'Pending-Credit': ['Open', 'Cancelled'],
  'Open': ['Accepted', 'Cancelled'],
  'Accepted': ['Picked Up', 'Open', 'Cancelled'],
  'Picked Up': ['Delivered', 'Cancelled'],
  'Delivered': ['Completed', 'Incomplete'],
  'Completed': [],
  'Cancelled': [],
  'Incomplete': [],
};

export const canTransition = (from: Status, to: Status): boolean =>
  ALLOWED[from].includes(to);
