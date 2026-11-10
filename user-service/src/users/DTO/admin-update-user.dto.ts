import { ApiPropertyOptional } from '@nestjs/swagger';
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
 * Fields an admin may set on another user via the admin user-update endpoint
 * (F11.1): the particulars from F10.1 plus Admin Status and archival state.
 *
 * Email is not restricted to NUS domains, mirroring admin-created users. A
 * successful email change locks the account; the user proves ownership of the
 * new address by completing the password-reset flow, which unlocks it.
 */
export class AdminUpdateUserDto {
  /**
   * The account's email. Any valid address is accepted, and the stored value
   * is lowercased. Changing it locks the account (see above).
   */
  @ApiPropertyOptional({
    example: 'alex.teo@u.nus.edu',
    format: 'email',
    maxLength: 255,
    description:
      'Any valid address. Changing the email locks the account until the user completes the password-reset flow.',
  })
  @Transform(({ value }: TransformFnParams) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @ValidateIf((_object, value) => value !== undefined)
  @IsEmail()
  @Length(1, 255)
  email?: string;

  @ApiPropertyOptional({ example: 'Alex Teo', minLength: 1, maxLength: 255 })
  @Transform(trim)
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Length(1, 255, {
    message: 'displayName must be 1-255 characters after trimming',
  })
  displayName?: string;

  /**
   * The full desired participant-role set (set-replace semantics). Removing a
   * role is rejected while that role has ongoing errands.
   */
  @ApiPropertyOptional({
    type: [String],
    enum: Role,
    example: [Role.Requester, Role.Courier],
    description:
      'Set-replaces the participant roles. An empty array removes every role.',
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsArray()
  @IsEnum(Role, { each: true })
  roles?: Role[];

  @ApiPropertyOptional({
    example: 'https://example.com/avatar.png',
    nullable: true,
    maxLength: 2083,
    description: 'An explicit null clears the stored picture.',
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

  /**
   * Archival Status. Optional, and held to the same strict
   * JSON-boolean rule as `isAdmin`. `true` archives the account, `false`
   * un-archives it.
   */
  @ApiPropertyOptional({ example: false })
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  isArchived?: boolean;
}
