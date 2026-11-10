import { QueryFailedError } from 'typeorm';
import { isDependencyUnavailableError } from './dependency-unavailable.js';

function withCode(code: string): Error {
  return Object.assign(new Error('driver failure'), { code });
}

describe('isDependencyUnavailableError', () => {
  it.each(['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNRESET'])(
    'treats network failure %s as unavailable',
    (code) => {
      expect(isDependencyUnavailableError(withCode(code))).toBe(true);
    },
  );

  it.each(['08006', '08001', '53300', '57P01', '57P03'])(
    'treats SQLSTATE %s as unavailable',
    (code) => {
      expect(isDependencyUnavailableError(withCode(code))).toBe(true);
    },
  );

  it('looks inside TypeORM query errors', () => {
    const error = new QueryFailedError(
      'SELECT 1',
      [],
      withCode('ECONNREFUSED'),
    );

    expect(isDependencyUnavailableError(error)).toBe(true);
  });

  it('recognises a dropped connection by its message', () => {
    expect(
      isDependencyUnavailableError(
        new Error('Connection terminated unexpectedly'),
      ),
    ).toBe(true);
  });

  it.each([
    ['unique violation', '23505'],
    ['check violation', '23514'],
    ['syntax error', '42601'],
  ])('does not treat a %s as unavailable', (_name, code) => {
    const error = new QueryFailedError('INSERT', [], withCode(code));

    expect(isDependencyUnavailableError(error)).toBe(false);
  });

  it('does not treat plain errors or non-errors as unavailable', () => {
    expect(isDependencyUnavailableError(new Error('boom'))).toBe(false);
    expect(isDependencyUnavailableError(undefined)).toBe(false);
    expect(isDependencyUnavailableError('ECONNREFUSED')).toBe(false);
  });
});
