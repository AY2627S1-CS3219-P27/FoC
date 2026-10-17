import { IsBoolean, ValidateIf } from 'class-validator';

/**
 * Fields an admin may set on another user via the admin user-update endpoint
 */
export class AdminUpdateUserDto {
  /**
   * Admin Status. Optional, but when present it must be a strict JSON
   * boolean: `"true"`/`"yes"`/`1`/`null` and other non-boolean values are
   * rejected.
   */
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  isAdmin?: boolean;

  /**
   * Archival Status. Optional, and held to the same strict
   * JSON-boolean rule as `isAdmin`. `true` archives the account, `false`
   * un-archives it.
   */
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  isArchived?: boolean;
}
