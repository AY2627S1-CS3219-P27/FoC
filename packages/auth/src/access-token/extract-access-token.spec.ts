import { ACCESS_TOKEN_COOKIE } from '@foc/contracts';
import { extractAccessToken } from './extract-access-token.js';

describe('extractAccessToken', () => {
  it('returns the access token from the cookie', () => {
    expect(
      extractAccessToken({
        cookies: { [ACCESS_TOKEN_COOKIE]: 'cookie-token' },
        headers: {},
      }),
    ).toBe('cookie-token');
  });

  it('falls back to the Authorization Bearer header without a cookie', () => {
    expect(
      extractAccessToken({
        cookies: {},
        headers: { authorization: 'Bearer header-token' },
      }),
    ).toBe('header-token');
  });

  it('prefers the cookie when both are present', () => {
    expect(
      extractAccessToken({
        cookies: { [ACCESS_TOKEN_COOKIE]: 'cookie-token' },
        headers: { authorization: 'Bearer header-token' },
      }),
    ).toBe('cookie-token');
  });

  it('handles an array-valued authorization header', () => {
    expect(
      extractAccessToken({
        cookies: {},
        headers: { authorization: ['Bearer first', 'Bearer second'] },
      }),
    ).toBe('first');
  });

  it('rejects an empty cookie value', () => {
    expect(
      extractAccessToken({
        cookies: { [ACCESS_TOKEN_COOKIE]: '' },
        headers: {},
      }),
    ).toBeNull();
  });

  it('rejects a malformed Bearer header', () => {
    expect(
      extractAccessToken({
        cookies: {},
        headers: { authorization: 'Token something' },
      }),
    ).toBeNull();
  });

  it('rejects a Bearer header with an empty token', () => {
    expect(
      extractAccessToken({
        cookies: {},
        headers: { authorization: 'Bearer    ' },
      }),
    ).toBeNull();
  });

  it('returns null when no token is present', () => {
    expect(extractAccessToken({ cookies: {}, headers: {} })).toBeNull();
    expect(extractAccessToken({})).toBeNull();
  });
});
