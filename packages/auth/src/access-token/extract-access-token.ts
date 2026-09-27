import { ACCESS_TOKEN_COOKIE } from '@foc/contracts';

// Standard bearer token auth - no need to put in contracts
export const AUTHORIZATION_HEADER = 'authorization';
export const BEARER_PREFIX = 'Bearer ';

/**
 * The minimal view of a request the extractor needs, kept structural so the
 * logic is unit-testable without a framework request object.
 */
export interface TokenRequestLike {
  cookies?: Record<string, unknown>;
  headers?: Record<string, string | string[] | undefined>;
}

/**
 * Returns the bearer access token for a request, or null when absent.
 *
 * Precedence: the httpOnly `access_token` cookie first (what browsers send
 * after a user-service login), then the `Authorization: Bearer` header (for
 * service-to-service).
 */
export function extractAccessToken(request: TokenRequestLike): string | null {
  const cookieToken = request.cookies?.[ACCESS_TOKEN_COOKIE];
  if (typeof cookieToken === 'string' && cookieToken.length > 0) {
    return cookieToken;
  }

  const authorization = request.headers?.[AUTHORIZATION_HEADER];
  const header = Array.isArray(authorization)
    ? authorization[0]
    : authorization;
  if (typeof header === 'string' && header.startsWith(BEARER_PREFIX)) {
    const token = header.slice(BEARER_PREFIX.length).trim();
    if (token.length > 0) {
      return token;
    }
  }

  return null;
}
