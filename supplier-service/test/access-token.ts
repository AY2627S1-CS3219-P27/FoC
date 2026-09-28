import { ACCESS_TOKEN_ISSUER, Role } from '@foc/contracts';
import { JwtService } from '@nestjs/jwt';

export interface TokenOptions {
  isAdmin?: boolean;
  issuer?: string;
  /** Seconds until expiry; negative for an already expired token. */
  expiresIn?: number;
  /** Claims to add, or to remove with `undefined`. */
  claims?: Record<string, unknown>;
}

/**
 * Signs an access token the way user-service's login does (RS256, the
 * contract's issuer, the standard claims), for e2e tests.
 */
export function signAccessToken(
  privateKey: string,
  options: TokenOptions = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = {
    sub: 7,
    email: 'eve@u.nus.edu',
    displayName: 'Eve',
    isAdmin: options.isAdmin ?? false,
    roles: [Role.Requester],
    iat: now,
    exp: now + (options.expiresIn ?? 900),
    ...options.claims,
  };
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined) {
      delete payload[key];
    }
  }
  return new JwtService({ privateKey }).signAsync(payload, {
    algorithm: 'RS256',
    issuer: options.issuer ?? ACCESS_TOKEN_ISSUER,
  });
}
