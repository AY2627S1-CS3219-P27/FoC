import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const trimEach = ({ value }: { value: unknown }) =>
  Array.isArray(value)
    ? value.map((item) => (typeof item === 'string' ? item.trim() : item))
    : value;

/**
 * The names of a building that an admin may change (F4.3): its canonical
 * name, its short name, and its aliases (replacing the whole list). At least
 * one must be sent; the controller checks that. Coordinates are not editable.
 */
export class UpdateBuildingDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 100, {
    message: 'canonicalName must be 1-100 characters after trimming',
  })
  canonicalName?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 20, {
    message: 'shortName must be 1-20 characters after trimming',
  })
  shortName?: string;

  @IsOptional()
  @Transform(trimEach)
  @IsArray()
  @ArrayMaxSize(20, { message: 'aliases must have at most 20 entries' })
  @IsString({ each: true })
  @Length(1, 100, {
    each: true,
    message: 'each alias must be 1-100 characters after trimming',
  })
  aliases?: string[];
}
