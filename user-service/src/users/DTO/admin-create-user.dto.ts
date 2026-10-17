import { Transform, type TransformFnParams } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { Role } from '@foc/contracts';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Fields an admin may set when creating a user.
 *
 * Email is not restricted to NUS domains here: admin-submitted
 * users may use any valid address.
 */
export class AdminCreateUserDto {
  @Transform(({ value }: TransformFnParams) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsEmail()
  @Length(1, 255)
  email: string;

  @Transform(trim)
  @IsString()
  @Length(1, 255, {
    message: 'displayName must be 1-255 characters after trimming',
  })
  displayName: string;

  @IsOptional()
  @IsArray()
  @IsEnum(Role, { each: true })
  roles?: Role[];

  @IsOptional()
  @IsString()
  @MaxLength(2083)
  @IsUrl(
    { require_protocol: true, protocols: ['http', 'https'] },
    { message: 'profilePictureUrl must be an http(s) URL' },
  )
  profilePictureUrl?: string | null;

  /**
   * Admin Status. Optional, but when present it must be a strict JSON
   * boolean: `"true"`/`"yes"`/`1`/`null` and other non-boolean values are
   * rejected.
   */
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  isAdmin?: boolean;
}
