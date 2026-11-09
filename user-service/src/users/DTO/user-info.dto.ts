import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '@foc/contracts';
import {
  EXAMPLE_NUS_EMAIL,
  EXAMPLE_USER_ID,
} from '../../http/api-doc-helpers.js';

/**
 * Fields every authenticated caller may see on a user. The admin-only flags
 * are optional here because non-admin callers of the list endpoint never
 * receive them; admins and self/admin reads do.
 */
export class UserInfoDto {
  @ApiProperty({ example: EXAMPLE_USER_ID, format: 'uuid' })
  uuid: string;

  @ApiProperty({ example: 'Alex Teo' })
  displayName: string;

  @ApiProperty({ example: EXAMPLE_NUS_EMAIL, format: 'email' })
  email: string;

  @ApiProperty({
    type: [String],
    enum: Role,
    example: [Role.Courier],
    description: 'Participant roles. May be empty.',
  })
  roles: Role[];

  @ApiProperty({
    example: 'https://example.com/avatar.png',
    nullable: true,
    type: String,
  })
  profilePictureUrl: string | null;

  @ApiPropertyOptional({
    example: false,
    description: 'Present only for admin callers of the list endpoint.',
  })
  isAdmin?: boolean;

  @ApiPropertyOptional({
    example: false,
    description: 'Present only for admin callers of the list endpoint.',
  })
  isLocked?: boolean;

  @ApiPropertyOptional({
    example: false,
    description: 'Present only for admin callers of the list endpoint.',
  })
  isArchived?: boolean;
}

/**
 * Admin view of a user: the basic fields plus account-management flags.
 * Always returned by the admin create/update endpoints.
 */
export class AdminUserInfoDto extends UserInfoDto {
  @ApiProperty({ example: false })
  declare isAdmin: boolean;

  @ApiProperty({ example: false })
  declare isLocked: boolean;

  @ApiProperty({ example: false })
  declare isArchived: boolean;
}

/** The role set on an account, as returned by the role-update endpoint. */
export class RolesDto {
  @ApiProperty({
    type: [String],
    enum: Role,
    example: [Role.Requester, Role.Courier],
  })
  roles: Role[];
}

/** A page from the users collection with the shared pagination metadata. */
export class PaginatedUsersDto {
  @ApiProperty({ type: [UserInfoDto] })
  items: UserInfoDto[];

  @ApiProperty({ example: 42, minimum: 0 })
  total: number;

  @ApiProperty({ example: 0, minimum: 0 })
  offset: number;

  @ApiProperty({ example: 25, minimum: 1 })
  limit: number;

  @ApiProperty({ example: false })
  hasMore: boolean;
}
