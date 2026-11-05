import { Role } from '@foc/contracts';
import { ArrayMinSize, IsArray, IsIn, IsUUID } from 'class-validator';
import { BLOCKABLE_ROLES } from './role-blocks.js';

// The body of POST and DELETE /v1/role-blocks.
export class RoleBlockDto {
  @IsUUID()
  userId: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsIn(BLOCKABLE_ROLES, { each: true })
  roles: Role[];
}
