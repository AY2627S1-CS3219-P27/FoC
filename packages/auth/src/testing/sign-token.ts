import { JwtService } from '@nestjs/jwt';
import { ACCESS_TOKEN_ISSUER, Role } from '@foc/contracts';

export interface SignTokenOverrides {
  sub?: string;
  email?: string;
  displayName?: string;
  isAdmin?: boolean;
  roles?: Role[];
  issuer?: string;
  expiresInSeconds?: number;
  extraClaims?: Record<string, unknown>;
}

/**
 * Signs an access token with the same library (and analogously configured
 * options) as user-service's login flow: RS256, the fixed issuer, and the
 * standard identity claims.
 */
export function signAccessToken(
  privateKeyPem: string,
  overrides: SignTokenOverrides = {},
): Promise<string> {
  const jwtService = new JwtService({
    privateKey: privateKeyPem,
    signOptions: {
      algorithm: 'RS256',
      issuer: overrides.issuer ?? ACCESS_TOKEN_ISSUER,
      expiresIn: overrides.expiresInSeconds ?? 900,
    },
  });
  return jwtService.signAsync({
    sub: overrides.sub ?? '11111111-1111-4111-8111-111111111111',
    email: overrides.email ?? 'eve@example.com',
    displayName: overrides.displayName ?? 'Eve',
    isAdmin: overrides.isAdmin ?? false,
    roles: overrides.roles ?? [Role.Requester],
    ...overrides.extraClaims,
  });
}
