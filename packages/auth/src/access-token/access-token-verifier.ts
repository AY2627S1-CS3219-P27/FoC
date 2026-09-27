import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  type AccessTokenPayload,
  validateAccessTokenPayload,
} from '@foc/contracts';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';

/** Thrown when a token fails signature, issuer, expiry, or contract checks. */
export class InvalidAccessTokenError extends Error {}

/**
 * Verifies an access-token JWT and maps its claims onto AuthenticatedUser.
 *
 * The JwtService it relies on is configured by FocAuthModule with the
 * service's public key, the RS256 algorithm, and the fixed issuer from
 * @foc/contracts, so every consuming service enforces the same wire contract:
 * signature first, then the strict claim schema from validateAccessTokenPayload.
 */
@Injectable()
export class AccessTokenVerifier {
  constructor(private readonly jwtService: JwtService) {}

  async verify(token: string): Promise<AuthenticatedUser> {
    let decoded: unknown;
    try {
      decoded = await this.jwtService.verifyAsync(token);
    } catch {
      throw new InvalidAccessTokenError(
        'Token failed signature, issuer, or expiry verification',
      );
    }

    const result = validateAccessTokenPayload(decoded);
    if (!result.valid) {
      throw new InvalidAccessTokenError(
        'Token claims violate the access-token contract',
      );
    }

    return toAuthenticatedUser(result.value);
  }
}

function toAuthenticatedUser(payload: AccessTokenPayload): AuthenticatedUser {
  return {
    sub: payload.sub,
    email: payload.email,
    displayName: payload.displayName,
    isAdmin: payload.isAdmin,
    roles: payload.roles,
  };
}
