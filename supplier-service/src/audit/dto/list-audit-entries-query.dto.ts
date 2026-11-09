import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { AUDIT_TARGET_TYPES } from '../../database/entities/index.js';
import { MAX_PAGE_SIZE } from '../../suppliers/dto/list-suppliers-query.dto.js';

/** UUIDs are lower-cased: PostgreSQL returns them lower-case. */
const lowerCase = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.toLowerCase() : value;

/**
 * Filters for reading the audit log. Unknown parameters are refused, like
 * every listing here. Every filter narrows the same query, so they combine
 * with AND.
 */
export class ListAuditEntriesQueryDto {
  @IsOptional()
  @IsIn(AUDIT_TARGET_TYPES, {
    message: `targetType must be one of ${AUDIT_TARGET_TYPES.join(', ')}`,
  })
  targetType?: (typeof AUDIT_TARGET_TYPES)[number];

  /** The id of the supplier, request, category, brand or building. */
  @IsOptional()
  @Transform(lowerCase)
  @IsUUID('all', { message: 'targetId must be a UUID' })
  targetId?: string;

  /** The user who made the change. */
  @IsOptional()
  @Transform(lowerCase)
  @IsUUID('all', { message: 'actorId must be a UUID' })
  actorId?: string;

  /** e.g. `supplier.updated`. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  action?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'offset must be a whole number' })
  @Min(0)
  offset: number = 0;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit must be a whole number' })
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit: number = 25;
}
