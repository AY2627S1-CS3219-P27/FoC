import type { Role } from '../user-roles/role.js';

/**
 * Decoded claims of a user-service access token. This shape is the wire
 * contract: it is defined here in @foc/contracts and strictly enforced by
 * `validateAccessTokenPayload`, so every issuing and verifying service agrees
 * on the token's claims by construction. `iss` is emitted by the signer's
 * fixed configuration, `iat`/`exp` by the JWT library.
 */
export interface AccessTokenPayload {
  /** The user's database id (JWT `sub`). */
  sub: number;
  email: string;
  displayName: string;
  /** Account classification, assigned by the system via admin bootstrap. */
  isAdmin: boolean;
  /** Self-opted participant roles as stamped into the token. */
  roles: Role[];
  iss: 'user-service';
  iat: number;
  exp: number;
}
