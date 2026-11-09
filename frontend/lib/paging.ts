export interface Loaded<T> {
  items: T[];
  total: number | null;
  hasMore: boolean;
}

// Fetches the first `count` items in pages of at most `maxLimit`, so "Load more" and polling share one request path.
// `getPage` returns null on failure. Without a total, a short page means the list has ended.
export async function fetchFirst<T>(
  count: number,
  maxLimit: number,
  getPage: (offset: number, limit: number) => Promise<{ items: T[]; total?: number } | null>,
): Promise<Loaded<T> | null> {
  const items: T[] = [];
  let total: number | null = null;
  let ended = false;
  while (items.length < count) {
    const limit = Math.min(maxLimit, count - items.length);
    const page = await getPage(items.length, limit);
    if (!page) return null;
    items.push(...page.items);
    if (typeof page.total === "number") total = page.total;
    // A short page ends the list, unless a total says more remain (the server capped the page size).
    const moreByTotal = total !== null && items.length < total && page.items.length > 0;
    if (page.items.length < limit && !moreByTotal) {
      ended = true;
      break;
    }
  }
  const hasMore = total !== null ? items.length < total : !ended;
  return { items, total, hasMore };
}
