import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@foc/contracts';
import type { AuthenticatedRequest } from '../authenticated-user.js';
import { ROLES_METADATA_KEY } from './roles.decorator.js';

/**
 * Authorization guard enforcing @Roles(...) with ANY-of semantics: the
 * authenticated user passes if their token roles include at least one of the
 * declared roles.
 *
 * Must run after jwt auth guard.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Reflector allows us to read the roles provided in the
    // decorator metadata: .e.g @Roles(Role.Courier, Role.Requestor)
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(
      ROLES_METADATA_KEY,
      // Checks role metadata on overall handler (route) first,
      // and if absent checks class (controller)
      [context.getHandler(), context.getClass()],
    );
    if (requiredRoles === undefined || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const hasRole = requiredRoles.some((role) =>
      request.user.roles.includes(role),
    );
    if (!hasRole) {
      throw new ForbiddenException('Insufficient roles');
    }
    return true;
  }
}
