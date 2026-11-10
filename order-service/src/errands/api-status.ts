import type { Status } from '../lifecycle/status.js';

// The read side's only view of status: client-facing name -> internal
// statuses behind it. Feeds both the response mapper and the `status` filter,
// so sub-states (Pending-Supplier, Reserving-Credit, Adjusting-Credit,
// Revalidating-Supplier, Settling-Credit) never reach a client. Transferring-Credit
// is the exception: it is client-facing as 'Processing transfer'. ARCHITECTURE.md §2.
export const INTERNAL_STATUSES_OF = {
  'Pending': ['Pending-Supplier', 'Reserving-Credit'],
  'Open': ['Open'],
  // An edit waiting on credit or supplier-service; the errand is still on offer but cannot be accepted meanwhile.
  'Updating': ['Adjusting-Credit', 'Revalidating-Supplier', 'Editing'],
  'Accepted': ['Accepted'],
  'Picked Up': ['Picked Up'],
  'Delivered': ['Delivered'],
  // Credit may still reject the transfer (-> Incomplete), so this must not read as Completed.
  'Processing transfer': ['Transferring-Credit'],
  'Completed': ['Completed'],
  'Cancelled': ['Cancelled'],
  'Incomplete': ['Incomplete', 'Settling-Credit'],
  'Resolved': ['Resolved'],
} as const satisfies Record<string, readonly Status[]>;

// What a courier can browse: an errand being edited stays visible.
export const OFFERED = [...INTERNAL_STATUSES_OF.Open, ...INTERNAL_STATUSES_OF.Updating] as const;

export type ApiStatus = keyof typeof INTERNAL_STATUSES_OF;

export const API_STATUSES = Object.keys(INTERNAL_STATUSES_OF) as ApiStatus[];

const API_STATUS_OF = Object.fromEntries(
  API_STATUSES.flatMap((api) => INTERNAL_STATUSES_OF[api].map((s) => [s, api])),
) as Record<Status, ApiStatus>;

export const toApiStatus = (status: Status): ApiStatus => API_STATUS_OF[status];

// Own-property check so 'constructor' and the like are not "statuses".
export const isApiStatus = (value: unknown): value is ApiStatus =>
  typeof value === 'string' && Object.hasOwn(INTERNAL_STATUSES_OF, value);
