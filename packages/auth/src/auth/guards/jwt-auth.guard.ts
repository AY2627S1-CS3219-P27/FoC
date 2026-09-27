import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AccessTokenVerifier } from '../../access-token/access-token-verifier.js';
import type { AuthenticatedRequest } from '../authenticated-user.js';
import { extractAccessToken } from '../../access-token/extract-access-token.js';

/**
 * Authentication guard. Verifies the bearer access token (cookie or
 * Authorization header) and attaches the AuthenticatedUser to
 * `request.user`. It only establishes identity; use RolesGuard or
 * AdminGuard alongside it to authorize.
 *
 * @Throws 401 UnauthorizedException for a missing, malformed, expired, or
 * contract-violating token.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly verifier: AccessTokenVerifier) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractAccessToken(request);
    if (token === null) {
      throw new UnauthorizedException('Missing access token');
    }

    try {
      request.user = await this.verifier.verify(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
    return true;
  }
}
