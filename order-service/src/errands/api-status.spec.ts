import { STATUSES } from '../lifecycle/status.js';
import {
  API_STATUSES,
  INTERNAL_STATUSES_OF,
  isApiStatus,
  toApiStatus,
} from './api-status.js';

describe('toApiStatus', () => {
  it.each([
    ['Pending-Supplier', 'Pending'],
    ['Reserving-Credit', 'Pending'],
    ['Open', 'Open'],
    ['Adjusting-Credit', 'Open'],
    ['Transferring-Credit', 'Completed'],
    ['Completed', 'Completed'],
    ['Accepted', 'Accepted'],
    ['Picked Up', 'Picked Up'],
    ['Delivered', 'Delivered'],
    ['Cancelled', 'Cancelled'],
    ['Incomplete', 'Incomplete'],
  ] as const)('%s is shown as %s', (internal, api) => {
    expect(toApiStatus(internal)).toBe(api);
  });

  it('covers every internal status exactly once', () => {
    const all = API_STATUSES.flatMap((s) => INTERNAL_STATUSES_OF[s]);
    expect([...all].sort()).toEqual([...STATUSES].sort());
  });
});

describe('INTERNAL_STATUSES_OF', () => {
  it('lets a Pending filter match both pending sub-states', () => {
    expect(INTERNAL_STATUSES_OF.Pending).toEqual(['Pending-Supplier', 'Reserving-Credit']);
  });
});

describe('isApiStatus', () => {
  it('accepts client-facing names', () => {
    for (const s of API_STATUSES) expect(isApiStatus(s)).toBe(true);
  });

  it('rejects internal sub-state names and junk', () => {
    for (const s of ['Pending-Supplier', 'Reserving-Credit', 'Adjusting-Credit', 'Transferring-Credit', 'open', '', 42, null]) {
      expect(isApiStatus(s)).toBe(false);
    }
  });
});
