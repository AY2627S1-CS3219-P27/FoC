import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { SupplierKind, SupplierStatus } from '../../database/entities/index.js';

export const SUPPLIER_SORTS = [
  'name',
  'building',
  'createdAt',
  'updatedAt',
] as const;
export type SupplierSort = (typeof SUPPLIER_SORTS)[number];

/** N3.1.1: never more than 1000 results in one response. */
export const MAX_PAGE_SIZE = 1000;

/** `?x=a&x=b` arrives as an array, `?x=a` as a string: always an array. */
const asArray = ({ value }: { value: unknown }) =>
  value === undefined || Array.isArray(value) ? value : [value];

/**
 * An id list, lower-cased: UUIDs are case-insensitive, but PostgreSQL
 * returns them lower-case, so this is how they compare equal.
 */
const asIdArray = (params: { value: unknown }) => {
  const list = asArray(params) as unknown;
  return Array.isArray(list)
    ? list.map((id: unknown) =>
        typeof id === 'string' ? id.toLowerCase() : id,
      )
    : list;
};

/**
 * The listing's query parameters (F5.2-F5.4, N3.1). Unknown parameters are
 * rejected by the global ValidationPipe rather than ignored (F5.8).
 * Repeatable filters are passed as repeated parameters, e.g.
 * `?categoryId=a&categoryId=b`.
 */
export class ListSuppliersQueryDto {
  /** Case-insensitive partial match on the name (F5.4.1). Blank = no filter. */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') {
      return value;
    }
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  })
  @IsString()
  @MaxLength(100)
  name?: string;

  /** Matches suppliers with any of these categories (F5.4.2). */
  @IsOptional()
  @Transform(asIdArray)
  @IsUUID('all', { each: true, message: 'each categoryId must be a UUID' })
  categoryId?: string[];

  /** Suppliers in any of these buildings (F5.4.3). */
  @IsOptional()
  @Transform(asIdArray)
  @IsUUID('all', { each: true, message: 'each buildingId must be a UUID' })
  buildingId?: string[];

  /** One or more kinds (F5.4.4). */
  @IsOptional()
  @Transform(asArray)
  @IsEnum(SupplierKind, {
    each: true,
    message: `kind must be one of ${Object.values(SupplierKind).join(', ')}`,
  })
  kind?: SupplierKind[];

  /** Omitted = both statuses (F5.4.5, F5.7). */
  @IsOptional()
  @IsEnum(SupplierStatus, {
    message: `status must be one of ${Object.values(SupplierStatus).join(', ')}`,
  })
  status?: SupplierStatus;

  /** Omitted = display name (F5.3); otherwise F5.3.1. */
  @IsOptional()
  @IsIn(SUPPLIER_SORTS, {
    message: `sort must be one of ${SUPPLIER_SORTS.join(', ')}`,
  })
  sort?: SupplierSort;

  @IsOptional()
  @IsIn(['asc', 'desc'], { message: 'order must be asc or desc' })
  order?: 'asc' | 'desc';

  /** N3.1.2: defaults to 0. */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'offset must be a whole number' })
  @Min(0)
  offset: number = 0;

  /** N3.1.2: defaults to 25; at most 1000 (N3.1.1). */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit must be a whole number' })
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit: number = 25;
}
