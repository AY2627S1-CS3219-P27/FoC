import type { Status } from '../lifecycle/status.js';

// The read side's only view of status: client-facing name -> internal
// statuses behind it. Feeds both the response mapper and the `status` filter,
// so sub-states (Pending-Supplier, Reserving-Credit, Adjusting-Credit,
// Transferring-Credit) never reach a client. ARCHITECTURE.md §2.
// NOTE THAT ADJUSTING CREDIT WILL LIKELY NEED MODIFICATIONS ONCE SUPPLIER INTEGRATION
// IS DONE
export const INTERNAL_STATUSES_OF = {
  'Pending': ['Pending-Supplier', 'Reserving-Credit'],
  'Open': ['Open', 'Adjusting-Credit'],
  'Accepted': ['Accepted'],
  'Picked Up': ['Picked Up'],
  'Delivered': ['Delivered'],
  'Completed': ['Completed', 'Transferring-Credit'],
  'Cancelled': ['Cancelled'],
  'Incomplete': ['Incomplete'],
} as const satisfies Record<string, readonly Status[]>;

export type ApiStatus = keyof typeof INTERNAL_STATUSES_OF;

export const API_STATUSES = Object.keys(INTERNAL_STATUSES_OF) as ApiStatus[];

const API_STATUS_OF = Object.fromEntries(
  API_STATUSES.flatMap((api) => INTERNAL_STATUSES_OF[api].map((s) => [s, api])),
) as Record<Status, ApiStatus>;

export const toApiStatus = (status: Status): ApiStatus => API_STATUS_OF[status];

// Own-property check so 'constructor' and the like are not "statuses".
export const isApiStatus = (value: unknown): value is ApiStatus =>
  typeof value === 'string' && Object.hasOwn(INTERNAL_STATUSES_OF, value);
