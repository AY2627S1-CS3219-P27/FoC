import {
  Body,
  Controller,
  Get,
  Patch,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../auth/authenticated-user.js';
import { JWT_COOKIE } from '../common/constants.js';
import { UpdateRolesDto } from './DTO/update-roles.dto.js';
import { UsersService } from './users.service.js';

@Controller('users')
export class UsersController {
  constructor(
    private usersService: UsersService,
    private configService: ConfigService,
  ) {}

  /**
   * The authenticated user's own profile and current persisted roles. Reads
   * roles from the database rather than the token, since the token may still
   * carry stale roles.
   */
  @Get('me')
  async getMe(@Req() request: AuthenticatedRequest) {
    const user = await this.usersService.getUserById(request.user.sub);
    if (user === null) {
      throw new UnauthorizedException();
    }
    return user;
  }

  /**
   * Set-replaces the authenticated user's participant roles. The
   * current access token is cleared so the client re-authenticates
   * and obtains a new access token with current claims.
   */
  @Patch('me/roles')
  async updateMeRoles(
    @Req() request: AuthenticatedRequest,
    @Body() updateRolesDto: UpdateRolesDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const updated = await this.usersService.updateRoles(
      request.user.sub,
      updateRolesDto.roles,
    );

    res.clearCookie(JWT_COOKIE, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: this.configService.get('NODE_ENV') === 'production',
    });

    return { roles: updated.roles };
  }
}
