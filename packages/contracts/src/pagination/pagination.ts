/**
 * System-wide pagination contract shared by every service that exposes
 * collection endpoints. The parameters and metadata are pinned here so all
 * services speak the same wire shape to clients.
 */

/** Hard ceiling on results in a single response */
export const MAX_PAGE_LIMIT = 1000;

/** Page size used when the caller omits `limit`  */
export const DEFAULT_PAGE_LIMIT = 25;

/** Page offset used when the caller omits `offset`  */
export const DEFAULT_PAGE_OFFSET = 0;

/** Pagination metadata attached to every paginated response  */
export interface PaginationMeta {
  /** Count of records matching the filters across all pages, not just this one. */
  total: number;
  /** The offset applied to this page. */
  offset: number;
  /** The limit applied to this page. */
  limit: number;
  /** True when another page of results exists after the current one. */
  hasMore: boolean;
}

/** A paginated collection response: one page of items plus metadata. */
export interface Paginated<T> extends PaginationMeta {
  items: T[];
}
