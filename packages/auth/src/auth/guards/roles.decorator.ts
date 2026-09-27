import { SetMetadata } from '@nestjs/common';
import { Role } from '@foc/contracts';

/**
 * Where nest stores the role metadata in the
 * decorator: @Roles(Role.courier) => { foc.roles = [Role.courier] }
 */
export const ROLES_METADATA_KEY = 'foc:roles';

/**
 * Requires the authenticated user to hold at least one of the listed
 * participant roles (ANY-of semantics). Omitting @Roles leaves a route open
 * to any authenticated user. Must be consumed by RolesGuard
 * (`@UseGuards(JwtAuthGuard, RolesGuard)`).
 */
export const Roles = (...roles: Role[]) =>
  SetMetadata(ROLES_METADATA_KEY, roles);
