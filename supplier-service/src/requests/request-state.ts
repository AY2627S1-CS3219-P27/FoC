import { RequestState } from '../database/entities/index.js';

/**
 * The allowed moves between request states (F6.1): a Pending request is
 * approved, denied or withdrawn once; Approved, Denied and Withdrawn are
 * final. Kept in one place, like order-service's lifecycle edges.
 */
const ALLOWED: Readonly<Record<RequestState, readonly RequestState[]>> = {
  [RequestState.Pending]: [
    RequestState.Approved,
    RequestState.Denied,
    RequestState.Withdrawn,
  ],
  [RequestState.Approved]: [],
  [RequestState.Denied]: [],
  [RequestState.Withdrawn]: [],
};

export function canMove(from: RequestState, to: RequestState): boolean {
  return ALLOWED[from].includes(to);
}

export function isFinal(state: RequestState): boolean {
  return ALLOWED[state].length === 0;
}
