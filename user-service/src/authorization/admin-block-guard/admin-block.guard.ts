import { AuthenticatedRequest } from '@foc/auth';
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AuthorizationService } from '../authorization.service.js';

/**
 * Rejects demoted admins whose still-valid access tokens carry stale
 * `isAdmin: true` claims. Must be stacked after `JwtAuthGuard`, which
 * attaches the authenticated user, and alongside the stateless
 * `AdminGuard`, which only reads the token claims.
 *
 * Fails closed: when the block status cannot be verified, the request is
 * rejected with 503 rather than allowed.
 */
@Injectable()
export class AdminBlockGuard implements CanActivate {
  constructor(private readonly authorizationService: AuthorizationService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (!request.user?.sub) {
      // Defensive: only meaningful stacked after JwtAuthGuard.
      throw new ForbiddenException();
    }

    let blocked: boolean;
    try {
      blocked = await this.authorizationService.checkIsAdminBlocked(
        request.user.sub,
      );
    } catch {
      throw new ServiceUnavailableException('Unable to verify admin status');
    }

    if (blocked) {
      throw new ForbiddenException('Admin access has been revoked');
    }

    return true;
  }
}
