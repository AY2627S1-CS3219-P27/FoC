import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
import { EXAMPLE_NUS_EMAIL } from '../../http/api-doc-helpers.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Fields an admin may set when creating a user.
 *
 * Email is not restricted to NUS domains here: admin-submitted
 * users may use any valid address.
 */
export class AdminCreateUserDto {
  @ApiProperty({
    example: EXAMPLE_NUS_EMAIL,
    format: 'email',
    maxLength: 255,
    description:
      'Not restricted to NUS domains: admin-submitted users may use any valid address.',
  })
  @Transform(({ value }: TransformFnParams) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsEmail()
  @Length(1, 255)
  email: string;

  @ApiProperty({ example: 'Alex Teo', minLength: 1, maxLength: 255 })
  @Transform(trim)
  @IsString()
  @Length(1, 255, {
    message: 'displayName must be 1-255 characters after trimming',
  })
  displayName: string;

  @ApiPropertyOptional({
    type: [String],
    enum: Role,
    example: [Role.Courier],
  })
  @IsOptional()
  @IsArray()
  @IsEnum(Role, { each: true })
  roles?: Role[];

  @ApiPropertyOptional({
    example: 'https://example.com/avatar.png',
    nullable: true,
    maxLength: 2083,
  })
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
  @ApiPropertyOptional({ example: false })
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  isAdmin?: boolean;
}
