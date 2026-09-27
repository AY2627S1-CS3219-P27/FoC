import type { AccessTokenPayload } from './access-token-payload.js';
import {
  ACCESS_TOKEN_ISSUER,
  validateAccessTokenPayload,
} from './validate-access-token-payload.js';
import { Role } from '../user-roles/role.js';

describe('validateAccessTokenPayload', () => {
  // A payload exactly as the JWT library would hand a verifier: the identity
  // claims issued at login plus the signer-emitted timestamp claims.
  const validPayload: AccessTokenPayload = {
    sub: 7,
    email: 'eve@example.com',
    displayName: 'Eve',
    isAdmin: false,
    roles: [Role.Requester, Role.Courier],
    iss: ACCESS_TOKEN_ISSUER,
    iat: 1_700_000_000,
    exp: 1_700_000_900,
  };

  it('accepts a fully conforming payload', () => {
    const result = validateAccessTokenPayload(validPayload);

    expect(result.valid).toBe(true);
    expect(result.valid && result.value).toEqual(validPayload);
  });

  it('accepts a user with no roles', () => {
    expect(
      validateAccessTokenPayload({ ...validPayload, roles: [] }).valid,
    ).toBe(true);
  });

  it('rejects a non-object input', () => {
    for (const input of ['token', 42, null, undefined, [], true]) {
      expect(validateAccessTokenPayload(input).valid).toBe(false);
    }
  });

  it('rejects unknown claims', () => {
    const result = validateAccessTokenPayload({
      ...validPayload,
      extraClaim: 'not part of the contract',
    });

    expect(result.valid).toBe(false);
    expect(result.valid || result.violations).toContainEqual(
      expect.objectContaining({
        instancePath: '/extraClaim',
        keyword: 'object.unknown',
      }),
    );
  });

  it('rejects a missing required claim', () => {
    const { roles: _roles, ...withoutRoles } = validPayload;

    expect(validateAccessTokenPayload(withoutRoles).valid).toBe(false);
  });

  it('rejects a non-integer sub', () => {
    expect(
      validateAccessTokenPayload({ ...validPayload, sub: 'not-a-number' })
        .valid,
    ).toBe(false);
    expect(
      validateAccessTokenPayload({ ...validPayload, sub: 7.5 }).valid,
    ).toBe(false);
  });

  it('rejects a malformed email', () => {
    expect(
      validateAccessTokenPayload({ ...validPayload, email: 'not-an-email' })
        .valid,
    ).toBe(false);
  });

  it('rejects an empty display name', () => {
    expect(
      validateAccessTokenPayload({ ...validPayload, displayName: '' }).valid,
    ).toBe(false);
  });

  it('rejects a non-boolean admin classification', () => {
    expect(
      validateAccessTokenPayload({ ...validPayload, isAdmin: 'yes' }).valid,
    ).toBe(false);
  });

  it('rejects a role value outside the participant enum', () => {
    const result = validateAccessTokenPayload({
      ...validPayload,
      roles: ['admin'],
    });

    expect(result.valid).toBe(false);
    expect(result.valid || result.violations[0]).toMatchObject({
      instancePath: '/roles/0',
      keyword: 'any.only',
    });
  });

  it('rejects duplicated roles', () => {
    expect(
      validateAccessTokenPayload({
        ...validPayload,
        roles: [Role.Requester, Role.Requester],
      }).valid,
    ).toBe(false);
  });

  it('rejects a token issued by another service', () => {
    expect(
      validateAccessTokenPayload({
        ...validPayload,
        iss: 'credit-service',
      }).valid,
    ).toBe(false);
  });

  it('rejects non-numeric timestamp claims', () => {
    expect(
      validateAccessTokenPayload({ ...validPayload, iat: '2026-01-01' }).valid,
    ).toBe(false);
    expect(
      validateAccessTokenPayload({ ...validPayload, exp: Number.NaN }).valid,
    ).toBe(false);
  });

  it('rejects non-finite timestamp claims', () => {
    const iatResult = validateAccessTokenPayload({
      ...validPayload,
      iat: Infinity,
    });
    expect(iatResult.valid).toBe(false);
    expect(iatResult.valid || iatResult.violations).toContainEqual(
      expect.objectContaining({
        instancePath: '/iat',
        keyword: 'number.infinity',
      }),
    );

    const expResult = validateAccessTokenPayload({
      ...validPayload,
      exp: -Infinity,
    });
    expect(expResult.valid).toBe(false);
    expect(expResult.valid || expResult.violations).toContainEqual(
      expect.objectContaining({
        instancePath: '/exp',
        keyword: 'number.infinity',
      }),
    );
  });

  it('reports violations with schema metadata but never claim values', () => {
    const result = validateAccessTokenPayload({ ...validPayload, sub: 'oops' });
    if (result.valid) {
      throw new Error('expected validation to fail');
    }

    expect(result.violations).toContainEqual(
      expect.objectContaining({
        instancePath: '/sub',
        keyword: 'number.base',
      }),
    );
    expect(JSON.stringify(result.violations)).not.toContain('oops');
  });
});
