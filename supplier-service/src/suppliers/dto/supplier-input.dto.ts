import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDefined,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  FLOOR_PATTERN,
  normaliseFloor,
} from '../../common/normalise/normalise.js';
import { SupplierKind } from '../../database/entities/index.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const FINITE = { allowNaN: false, allowInfinity: false } as const;

export class CoordinatesDto {
  @IsNumber(FINITE, { message: 'latitude must be a number' })
  @Min(-90)
  @Max(90)
  latitude: number;

  @IsNumber(FINITE, { message: 'longitude must be a number' })
  @Min(-180)
  @Max(180)
  longitude: number;
}

/**
 * The client-settable supplier fields and their rules (F1.2). System-managed
 * fields (id, status, version, timestamps) are deliberately absent, so a
 * request supplying one is rejected as an unknown field (F1.3.2). The same
 * rules serve the seed import and the admin API, so the two cannot disagree
 * (F1.7). Rules that need configuration or the database (campus box,
 * non-retired references) are checked by the suppliers service.
 */
export class SupplierInputDto {
  @Transform(trim)
  @IsString()
  @Length(1, 100, { message: 'name must be 1-100 characters after trimming' })
  name: string;

  @IsEnum(SupplierKind, {
    message: `kind must be one of ${Object.values(SupplierKind).join(', ')}`,
  })
  kind: SupplierKind;

  @IsArray()
  @ArrayMinSize(1, { message: 'at least one category is required' })
  @ArrayUnique({ message: 'categoryIds must not contain duplicates' })
  @IsUUID('all', { each: true, message: 'each category id must be a UUID' })
  categoryIds: string[];

  @IsUUID('all', { message: 'buildingId must be a UUID' })
  buildingId: string;

  @Transform(({ value }) =>
    typeof value === 'string' ? normaliseFloor(value) : value,
  )
  @IsString()
  @Matches(FLOOR_PATTERN, { message: 'floor must be B1-B9, 1-99 or M' })
  floor: string;

  @Transform(trim)
  @IsString()
  @Length(1, 255, {
    message: 'locationDescription must be 1-255 characters after trimming',
  })
  locationDescription: string;

  @IsDefined({ message: 'coordinates are required' })
  @ValidateNested()
  @Type(() => CoordinatesDto)
  coordinates: CoordinatesDto;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @IsUrl(
    { require_protocol: true, protocols: ['http', 'https'] },
    { message: 'photoUrl must be an http(s) URL' },
  )
  photoUrl?: string | null;
}
