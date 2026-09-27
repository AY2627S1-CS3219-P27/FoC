import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../authenticated-user.js';

/**
 * Authorization guard for admin-only endpoints: requires the authenticated
 * user's account to be classified admin.
 *
 * Must run after JwtAuthGuard.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user.isAdmin) {
      throw new ForbiddenException('Admin privileges required');
    }
    return true;
  }
}
