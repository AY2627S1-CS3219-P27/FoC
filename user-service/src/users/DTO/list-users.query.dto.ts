import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import {
  DEFAULT_PAGE_LIMIT,
  DEFAULT_PAGE_OFFSET,
  MAX_PAGE_LIMIT,
  Role,
} from '@foc/contracts';

/**
 * Coerces a query-string boolean. Only the exact tokens `'true'`/`'false'`
 * (and already-boolean values) pass through converted; anything else stays
 * as-is so `@IsBoolean` rejects it instead of silently coercing `'yes'` to
 * `true`.
 */
export const parseQueryBoolean = ({
  value,
}: {
  value: unknown;
}): unknown => {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return value;
};

/**
 * Query parameters for the users collection endpoint (M.1 F10.3/F10.4,
 * N3.1.2). The admin-only flags are still validated here for every caller;
 * the controller rejects their presence for non-admin callers.
 */
export class ListUsersQueryDto {
  /** Zero-based offset into the full result set, default 0. */
  @IsInt()
  @Min(0)
  @Type(() => Number)
  offset: number = DEFAULT_PAGE_OFFSET;

  /** Maximum page size, default 25 and capped at 1000 (N3.1.1). */
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_LIMIT)
  @Type(() => Number)
  limit: number = DEFAULT_PAGE_LIMIT;

  /** Filter to users holding this participant role (F10.3). */
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  /** Admin-only: filter to admin/non-admin accounts (F10.4). */
  @IsOptional()
  @IsBoolean()
  @Transform(parseQueryBoolean)
  isAdmin?: boolean;

  /** Admin-only: filter to locked/unlocked accounts (F10.4). */
  @IsOptional()
  @IsBoolean()
  @Transform(parseQueryBoolean)
  isLocked?: boolean;

  /** Admin-only: filter to archived/live accounts (F10.4). */
  @IsOptional()
  @IsBoolean()
  @Transform(parseQueryBoolean)
  isArchived?: boolean;
}