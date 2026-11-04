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
 * A verified access-token identity plus connection-lifetime metadata.
 *
 * `expiresAt` is derived from the validated JWT `exp` NumericDate. Consumers
 * can use it to end long-lived connections without retaining the raw token or
 * decoded claims.
 */
export interface VerifiedAccessToken {
  user: AuthenticatedUser;
  expiresAt: Date;
}

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
    const verified = await this.verifyWithMetadata(token);
    return verified.user;
  }

  /**
   * Verifies an access token and returns identity plus its absolute expiry.
   *
   * This applies exactly the same signature, issuer, expiry, and strict claim
   * validation as `verify()`.
   */
  async verifyWithMetadata(token: string): Promise<VerifiedAccessToken> {
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

    return {
      user: toAuthenticatedUser(result.value),
      expiresAt: new Date(result.value.exp * 1_000),
    };
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
