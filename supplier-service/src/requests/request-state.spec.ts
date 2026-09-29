import { RequestState } from '../database/entities/index.js';
import { canMove, isFinal } from './request-state.js';

const { Pending, Approved, Denied, Withdrawn } = RequestState;

describe('request states (F6.1)', () => {
  it('lets a Pending request be approved, denied or withdrawn', () => {
    expect(canMove(Pending, Approved)).toBe(true);
    expect(canMove(Pending, Denied)).toBe(true);
    expect(canMove(Pending, Withdrawn)).toBe(true);
  });

  it.each([Approved, Denied, Withdrawn])('treats %s as final', (state) => {
    expect(isFinal(state)).toBe(true);
    for (const to of [Pending, Approved, Denied, Withdrawn]) {
      expect(canMove(state, to)).toBe(false);
    }
  });

  it('does not treat Pending as final', () => {
    expect(isFinal(Pending)).toBe(false);
  });
});
