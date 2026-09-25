import type { Request } from 'express';
import type { Role } from '../users/role.js';

/**
 * The identity claims JwtAuthGuard attaches to `request.user` after verifying
 * the access token.
 **/
export interface AuthenticatedUser {
  /** The user's database id (JWT `sub`). */
  sub: number;
  email: string;
  displayName: string;
  /** Account classification, assigned by the system via admin bootstrap. */
  isAdmin: boolean;
  /** Self-opted participant roles as stamped into the token. */
  roles: Role[];
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}
