import { RefreshToken } from './refresh-token.entity.js';
import { REFRESH_TOKEN_EXPIRATION_IN_SECONDS } from '../common/constants.js';

describe('RefreshToken entity', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sets expiresAt to the refresh-token lifetime on insert', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-14T00:00:00Z'));

    const token = new RefreshToken();
    token.calculateEndDate();

    // @BeforeInsert schedules expiry `REFRESH_TOKEN_EXPIRATION_IN_SECONDS`
    // (7 days) after issuance; this keeps the DB row's lifetime aligned with
    // the cookie maxAge the controller sets.
    expect(token.expiresAt.getTime()).toBe(
      new Date('2026-10-14T00:00:00Z').getTime() +
        REFRESH_TOKEN_EXPIRATION_IN_SECONDS * 1000,
    );
  });
});
