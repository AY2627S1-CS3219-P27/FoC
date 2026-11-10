import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsEnum } from 'class-validator';
import { Role } from '@foc/contracts';

/**
 * The full desired participant-role set for the authenticated user (M.1
 * F13). Set-replace semantics: an empty array opts out of every role.
 * Duplicates are tolerated and normalised away by the service; only the two
 * participant roles exist, and `admin` cannot appear here by construction.
 */
export class UpdateRolesDto {
  @ApiProperty({
    type: [String],
    enum: Role,
    example: [Role.Requester, Role.Courier],
    description:
      'Set-replaces the participant roles. An empty array opts out of every role.',
  })
  @IsArray()
  @IsEnum(Role, { each: true })
  roles: Role[];
}
