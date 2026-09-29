import { Role } from '@foc/contracts';
import { User } from './user.entity.js';

/**
 * Fields every caller may see on a listed user (M.1 F10.1). Credentials and
 * internal flags are never projected here.
 */
export interface BasicUserInfoView {
  uuid: string;
  displayName: string;
  email: string;
  roles: Role[];
  profilePictureUrl: string | null;
}

/**
 * Admin-only extension of the basic view (M.1 F10.2): account-management
 * flags that must not leak to non-admin callers.
 */
export interface AdminUserInfoView extends BasicUserInfoView {
  isAdmin: boolean;
  isLocked: boolean;
  isArchived: boolean;
}

export type UserInfoView = BasicUserInfoView | AdminUserInfoView;

/**
 * Projects a stored user row into the wire view. The `isAdmin` caller flag
 * decides whether account-management flags are included: it comes from the
 * request claims, never from the row being listed.
 */
export function toUserInfoView(
  user: User,
  { includeAdminFlags }: { includeAdminFlags: boolean },
): UserInfoView {
  const basic: BasicUserInfoView = {
    uuid: user.uuid,
    displayName: user.displayName,
    email: user.email,
    roles: user.roles ?? [],
    profilePictureUrl: user.profilePictureUrl ?? null,
  };

  if (!includeAdminFlags) {
    return basic;
  }

  return {
    ...basic,
    isAdmin: user.isAdmin,
    isLocked: user.isLocked,
    isArchived: user.isArchived,
  };
}