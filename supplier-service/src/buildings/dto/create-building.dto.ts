import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsObject,
  IsOptional,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';
import { CoordinatesDto } from '../../suppliers/dto/supplier-input.dto.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const trimEach = ({ value }: { value: unknown }) =>
  Array.isArray(value)
    ? value.map((item) => (typeof item === 'string' ? item.trim() : item))
    : value;

/** The fields of a new building (F4.3, F4.1). Coordinates must lie on campus. */
export class CreateBuildingDto {
  @Transform(trim)
  @IsString()
  @Length(1, 100, {
    message: 'canonicalName must be 1-100 characters after trimming',
  })
  canonicalName: string;

  @Transform(trim)
  @IsString()
  @Length(1, 20, {
    message: 'shortName must be 1-20 characters after trimming',
  })
  shortName: string;

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

  @IsDefined({ message: 'coordinates are required' })
  @IsObject({
    message: 'coordinates must be an object with latitude and longitude',
  })
  @ValidateNested()
  @Type(() => CoordinatesDto)
  coordinates: CoordinatesDto;
}
