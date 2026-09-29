import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Patch,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { JwtAuthGuard } from '@foc/auth';
import type { AuthenticatedRequest } from '@foc/auth';
import type { Paginated } from '@foc/contracts';
import { ACCESS_TOKEN_COOKIE } from '@foc/contracts';
import { UpdateRolesDto } from './DTO/update-roles.dto.js';
import { UpdateProfileDto } from './DTO/update-profile.dto.js';
import { ListUsersQueryDto } from './DTO/list-users.query.dto.js';
import { toUserInfoView, UserInfoView } from './user-info.view.js';
import { UsersService } from './users.service.js';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(
    private usersService: UsersService,
    private configService: ConfigService,
  ) {}

  /**
   * Paginated users list. Basic users filter by role and receive the
   * basic field view; admin callers additionally gain the
   * account-management filters and fields.
   *
   * Requests carrying admin-only filters from a non-admin are rejected outright.
   */
  @Get()
  async listUsers(
    @Req() request: AuthenticatedRequest,
    @Query() query: ListUsersQueryDto,
  ): Promise<Paginated<UserInfoView>> {
    const isAdmin = request.user.isAdmin;

    const adminFilterRequested =
      query.isAdmin !== undefined ||
      query.isLocked !== undefined ||
      query.isArchived !== undefined;

    if (adminFilterRequested && !isAdmin) {
      throw new ForbiddenException(
        'Filters isAdmin, isLocked and isArchived require an admin account.',
      );
    }

    const { users, total, offset, limit } = await this.usersService.listUsers({
      role: query.role,
      // Only admins reach this call with admin-only filters: the gate
      // above already rejected non-admin requests that supplied them.
      isAdmin: query.isAdmin,
      isLocked: query.isLocked,
      isArchived: query.isArchived,
      offset: query.offset,
      limit: query.limit,
    });

    const items = users.map((user) =>
      toUserInfoView(user, { includeAdminFlags: isAdmin }),
    );

    return {
      items,
      total,
      offset,
      limit,
      hasMore: offset + items.length < total,
    };
  }

  /**
   * The authenticated user's own profile and current persisted roles. Reads
   * roles from the database rather than the token, since the token may still
   * carry stale roles.
   */
  @Get('me')
  async getMe(@Req() request: AuthenticatedRequest) {
    const user = await this.usersService.getUserByUuid(request.user.sub);
    if (user === null) {
      throw new UnauthorizedException();
    }
    return user;
  }

  /**
   * Updates the authenticated user's particulars: display name and
   * profile picture URL, each optional.
   *
   * When the display name actually changes the access token is
   * cleared, since the token embeds the display name as a claim.
   */
  @Patch('me')
  async updateMeProfile(
    @Req() request: AuthenticatedRequest,
    @Body() updateProfileDto: UpdateProfileDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const updated = await this.usersService.updateProfile(
      request.user.sub,
      updateProfileDto,
    );

    if (updated.displayName !== request.user.displayName) {
      res.clearCookie(ACCESS_TOKEN_COOKIE, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: this.configService.get('NODE_ENV') === 'production',
      });
    }

    return updated;
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

    res.clearCookie(ACCESS_TOKEN_COOKIE, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: this.configService.get('NODE_ENV') === 'production',
    });

    return { roles: updated.roles };
  }
}
