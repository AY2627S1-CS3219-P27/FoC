import { IsArray, IsEnum } from 'class-validator';
import { Role } from '../role.js';

/**
 * The full desired participant-role set for the authenticated user (M.1
 * F13). Set-replace semantics: an empty array opts out of every role.
 * Duplicates are tolerated and normalised away by the service; only the two
 * participant roles exist, and `admin` cannot appear here by construction.
 */
export class UpdateRolesDto {
  @IsArray()
  @IsEnum(Role, { each: true })
  roles: Role[];
}