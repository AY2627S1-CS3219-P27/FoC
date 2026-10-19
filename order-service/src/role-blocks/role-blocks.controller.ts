import { type AuthenticatedRequest, JwtAuthGuard } from '@foc/auth';
import {
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { BlockableRole } from './role-blocks.js';
import { RoleBlockDto } from './role-blocks.dto.js';
import { RoleBlocksService } from './role-blocks.service.js';

// Called by user-service with the acting user's (or an admin's) token. The rule
// is "admin or self", so it is checked here rather than with AdminGuard.
@Controller('v1/role-blocks')
@UseGuards(JwtAuthGuard)
export class RoleBlocksController {
  constructor(private readonly blocks: RoleBlocksService) {}

  @Post()
  @HttpCode(200)
  async block(@Body() body: RoleBlockDto, @Req() req: AuthenticatedRequest) {
    const roles = this.allowed(body, req);
    const result = await this.blocks.block(body.userId, roles);
    if (!result.ok) {
      throw new ConflictException({
        code: 'ROLE_IN_USE',
        message: 'The user still has ongoing errands for these roles.',
        roles: result.inUse,
      });
    }
    return { blocked: result.blocked, expiresAt: result.expiresAt.toISOString() };
  }

  @Delete()
  @HttpCode(200)
  async unblock(@Body() body: RoleBlockDto, @Req() req: AuthenticatedRequest) {
    const roles = this.allowed(body, req);
    await this.blocks.unblock(body.userId, roles);
    return { unblocked: roles };
  }

  // Admin, or the user acting on themselves. Returns the roles, duplicates collapsed.
  private allowed(body: RoleBlockDto, req: AuthenticatedRequest) {
    if (!req.user.isAdmin && req.user.sub !== body.userId) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You can only change your own roles.',
      });
    }
    return [...new Set(body.roles)] as BlockableRole[];
  }
}
