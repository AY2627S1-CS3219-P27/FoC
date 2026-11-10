import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { AdminGuard, JwtAuthGuard, extractAccessToken } from '@foc/auth';
import type { AuthenticatedRequest } from '@foc/auth';
import type { Paginated } from '@foc/contracts';
import { ACCESS_TOKEN_COOKIE } from '@foc/contracts';
import {
  BEARER_SECURITY_SCHEME,
  ACCESS_TOKEN_COOKIE_SECURITY_SCHEME,
} from '../http/configure-http.js';
import { ApiErrorDto } from '../http/api-error.dto.js';
import {
  errorResponse,
  EXAMPLE_USER_ID,
  successResponse,
  validationErrorExample,
} from '../http/api-doc-helpers.js';
import { UpdateRolesDto } from './DTO/update-roles.dto.js';
import { UpdateProfileDto } from './DTO/update-profile.dto.js';
import { AdminCreateUserDto } from './DTO/admin-create-user.dto.js';
import { AdminUpdateUserDto } from './DTO/admin-update-user.dto.js';
import { ListUsersQueryDto } from './DTO/list-users.query.dto.js';
import {
  AdminUserInfoDto,
  PaginatedUsersDto,
  RolesDto,
  UserInfoDto,
} from './DTO/user-info.dto.js';
import {
  AdminUserInfoView,
  toUserInfoView,
  UserInfoView,
} from './user-info.view.js';
import { PublicUserInfo, UsersService } from './users.service.js';
import { AdminBlockGuard } from '../authorization/admin-block-guard/admin-block.guard.js';

const UNAUTHORIZED_EXAMPLE = {
  statusCode: 401,
  message: 'Unauthorized',
  error: 'Unauthorized',
};

@ApiTags('users')
@ApiExtraModels(
  ApiErrorDto,
  UserInfoDto,
  AdminUserInfoDto,
  PaginatedUsersDto,
  RolesDto,
)
@ApiProduces('application/json')
@ApiBearerAuth(BEARER_SECURITY_SCHEME)
@ApiSecurity(ACCESS_TOKEN_COOKIE_SECURITY_SCHEME)
@ApiUnauthorizedResponse(
  errorResponse(
    'The access token is missing or invalid.',
    UNAUTHORIZED_EXAMPLE,
  ),
)
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
  @ApiOperation({
    summary: 'List users (paginated)',
    description:
      'Non-admin callers filter by role and receive the basic field view. ' +
      'Admin callers additionally gain the isAdmin/isLocked/isArchived filters and receive the management flags on every item.',
  })
  @ApiOkResponse(
    successResponse(
      PaginatedUsersDto,
      'One page of users plus pagination metadata. The example shows the admin view; non-admin callers receive items without the isAdmin, isLocked and isArchived flags.',
      {
        items: [
          {
            uuid: EXAMPLE_USER_ID,
            displayName: 'Alex Teo',
            email: 'alex.teo@u.nus.edu',
            roles: ['courier'],
            profilePictureUrl: null,
            isAdmin: false,
            isLocked: false,
            isArchived: false,
          },
        ],
        total: 42,
        offset: 0,
        limit: 25,
        hasMore: true,
      },
    ),
  )
  @ApiForbiddenResponse(
    errorResponse(
      'A non-admin supplied the isAdmin, isLocked or isArchived filters.',
      {
        statusCode: 403,
        message:
          'Filters isAdmin, isLocked and isArchived require an admin account.',
        error: 'Forbidden',
      },
    ),
  )
  @ApiBadRequestResponse(
    errorResponse('The query parameters violate the constraints.', {
      ...validationErrorExample(['limit must not be greater than 1000']),
    }),
  )
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
  @ApiOperation({
    summary: "Get the authenticated user's own profile",
    description:
      'Reads roles from the database rather than the token, since the token may still carry stale roles.',
  })
  @ApiOkResponse(
    successResponse(UserInfoDto, "The authenticated user's profile.", {
      uuid: EXAMPLE_USER_ID,
      displayName: 'Alex Teo',
      email: 'alex.teo@u.nus.edu',
      roles: ['requester'],
      profilePictureUrl: null,
      isAdmin: false,
    }),
  )
  async getMe(@Req() request: AuthenticatedRequest) {
    const user = await this.usersService.getUserByUuid(request.user.sub);
    if (user === null) {
      throw new UnauthorizedException();
    }
    return user;
  }

  /**
   * A single user's profile by UUID. Declared after the `me` routes so
   * Nest resolves `GET /users/me` before the `:uuid` parameter route.
   *
   * Non-admin callers only see active accounts: locked and archived ones
   * resolve to 404, matching the login rule. Admins and users reading
   * themselves may see any account state, as with `/users/me`. Account
   * management flags stay on the list and admin-update endpoints.
   */
  @Get(':uuid')
  @ApiOperation({
    summary: "Get a user's profile by UUID",
    description:
      'Non-admin callers only see active accounts: locked and archived accounts resolve to 404, matching the login rule. ' +
      'Admins and users reading themselves may see any account state.',
  })
  @ApiOkResponse(
    successResponse(UserInfoDto, "The requested user's profile.", {
      uuid: EXAMPLE_USER_ID,
      displayName: 'Alex Teo',
      email: 'alex.teo@u.nus.edu',
      roles: [],
      profilePictureUrl: null,
      isAdmin: false,
    }),
  )
  @ApiNotFoundResponse(
    errorResponse('No visible user exists with that UUID.', {
      statusCode: 404,
      message: 'Not Found',
      error: 'Not Found',
    }),
  )
  @ApiBadRequestResponse(
    errorResponse('The path parameter is not a UUID.', {
      ...validationErrorExample(['uuid must be a UUID']),
    }),
  )
  async getUser(
    @Req() request: AuthenticatedRequest,
    @Param('uuid', new ParseUUIDPipe()) uuid: string,
  ): Promise<PublicUserInfo> {
    const isSelf = request.user.sub === uuid;

    // Non-admin users can only get active user info
    const user =
      request.user.isAdmin || isSelf
        ? await this.usersService.getUserByUuid(uuid)
        : await this.usersService.getActiveUserByUuid(uuid);

    if (user === null) {
      throw new NotFoundException();
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
  @ApiOperation({
    summary: "Update the authenticated user's profile",
    description:
      'Only the fields present in the body are written. When the display name changes the access_token cookie is cleared, since the token embeds the display name as a claim.',
  })
  @ApiBody({ type: UpdateProfileDto })
  @ApiOkResponse(
    successResponse(UserInfoDto, 'The updated profile.', {
      uuid: EXAMPLE_USER_ID,
      displayName: 'Alex Teo',
      email: 'alex.teo@u.nus.edu',
      roles: [],
      profilePictureUrl: 'https://example.com/avatar.png',
      isAdmin: false,
    }),
  )
  @ApiBadRequestResponse(
    errorResponse('The request body violates the field constraints.', {
      ...validationErrorExample(['profilePictureUrl must be an http(s) URL']),
    }),
  )
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
   *
   * The token is forwarded to order-service, which checks the roles for
   * ongoing errands and blocks them before they leave the account.
   */
  @Patch('me/roles')
  @ApiOperation({
    summary: "Set-replace the authenticated user's participant roles",
    description:
      'Set-replace semantics: an empty array opts out of every role. The access_token cookie is cleared so the client re-authenticates with current claims.',
  })
  @ApiBody({ type: UpdateRolesDto })
  @ApiOkResponse(
    successResponse(RolesDto, 'The updated role set.', {
      roles: ['requester', 'courier'],
    }),
  )
  @ApiBadRequestResponse(
    errorResponse('The request body violates the field constraints.', {
      ...validationErrorExample([
        'each value in roles must be one of the following values: requester, courier',
      ]),
    }),
  )
  async updateMeRoles(
    @Req() request: AuthenticatedRequest,
    @Body() updateRolesDto: UpdateRolesDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const accessToken = extractAccessToken(request);
    if (accessToken === null) {
      // Unreachable behind JwtAuthGuard, which rejects tokenless requests.
      throw new UnauthorizedException();
    }

    const updated = await this.usersService.updateRoles(
      request.user.sub,
      updateRolesDto.roles,
      accessToken,
    );

    res.clearCookie(ACCESS_TOKEN_COOKIE, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: this.configService.get('NODE_ENV') === 'production',
    });

    return { roles: updated.roles };
  }

  /**
   * Archives the authenticated user's own account.
   *
   * The token is forwarded to order-service, which checks the account's
   * roles for ongoing errands and blocks them before the archive commits.
   */
  @Post('me/archive')
  @ApiOperation({
    summary: "Archive the authenticated user's own account",
    description: 'The access_token cookie is cleared after archiving.',
  })
  @ApiOkResponse({
    description: 'The archived account state.',
    content: {
      'application/json': {
        example: { uuid: EXAMPLE_USER_ID, isArchived: true },
      },
    },
  })
  async archiveMe(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const accessToken = extractAccessToken(request);
    if (accessToken === null) {
      // Unreachable behind JwtAuthGuard, which rejects tokenless requests.
      throw new UnauthorizedException();
    }

    const archived = await this.usersService.archiveSelf(
      request.user.sub,
      accessToken,
    );

    res.clearCookie(ACCESS_TOKEN_COOKIE, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: this.configService.get('NODE_ENV') === 'production',
    });

    return { uuid: archived.uuid, isArchived: archived.isArchived };
  }

  /**
   * Admin-only user update: particulars, roles, admin status and archival
   * state (F11.1). Returns the stored account projected as the admin view, so
   * the caller can read back the values their change produced.
   *
   * The admin's token is forwarded to order-service, which checks the
   * target's roles for ongoing errands and blocks them before an archive
   * commits or a role is removed.
   */
  @Patch(':uuid')
  @UseGuards(AdminGuard, AdminBlockGuard)
  @ApiOperation({
    summary: 'Admin-only user update',
    description:
      'Updates the particulars from F10.1, participant roles, admin status and archival state. Changing the email locks the account until the user completes the password-reset flow. Returns the stored account projected as the admin view.',
  })
  @ApiBody({ type: AdminUpdateUserDto })
  @ApiOkResponse(
    successResponse(AdminUserInfoDto, 'The updated account, admin view.', {
      uuid: EXAMPLE_USER_ID,
      displayName: 'Alex Teo',
      email: 'alex.teo@u.nus.edu',
      roles: [],
      profilePictureUrl: null,
      isAdmin: false,
      isLocked: false,
      isArchived: true,
    }),
  )
  @ApiForbiddenResponse(
    errorResponse('The caller is not an admin (or is themselves blocked).', {
      statusCode: 403,
      message: 'Forbidden',
      error: 'Forbidden',
    }),
  )
  @ApiNotFoundResponse(
    errorResponse('No user exists with that UUID.', {
      statusCode: 404,
      message: 'Not Found',
      error: 'Not Found',
    }),
  )
  @ApiBadRequestResponse(
    errorResponse('The body or path parameters violate the constraints.', {
      ...validationErrorExample(['isAdmin must be a boolean value']),
    }),
  )
  async adminUpdateUser(
    @Req() request: AuthenticatedRequest,
    @Param('uuid', new ParseUUIDPipe()) uuid: string,
    @Body() adminUpdateUserDto: AdminUpdateUserDto,
  ) {
    const accessToken = extractAccessToken(request);
    if (accessToken === null) {
      // Unreachable behind JwtAuthGuard, which rejects tokenless requests.
      throw new UnauthorizedException();
    }

    const updated = await this.usersService.adminUpdateUser(
      request.user.sub,
      uuid,
      adminUpdateUserDto,
      accessToken,
    );

    return toUserInfoView(updated, { includeAdminFlags: true });
  }

  /**
   * Admin-only user creation. Provisions a locked account with a
   * random discarded password that the end-user replaces through the
   * password-reset flow. The caller is always an admin, so the returned view
   * always includes the account-management flags.
   */
  @Post()
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'Admin-only user creation',
    description:
      'Provisions a locked account with a random discarded password that the end-user replaces through the password-reset flow.',
  })
  @ApiBody({ type: AdminCreateUserDto })
  @ApiCreatedResponse(
    successResponse(AdminUserInfoDto, 'The created account, admin view.', {
      uuid: EXAMPLE_USER_ID,
      displayName: 'Alex Teo',
      email: 'alex.teo@u.nus.edu',
      roles: ['requester'],
      profilePictureUrl: null,
      isAdmin: false,
      isLocked: true,
      isArchived: false,
    }),
  )
  @ApiConflictResponse(
    errorResponse('The email is already registered.', {
      statusCode: 409,
      message: 'Email is already registered.',
      error: 'Conflict',
    }),
  )
  @ApiForbiddenResponse(
    errorResponse('The caller is not an admin.', {
      statusCode: 403,
      message: 'Forbidden',
      error: 'Forbidden',
    }),
  )
  @ApiBadRequestResponse(
    errorResponse('The request body violates the field constraints.', {
      ...validationErrorExample(['email must be an email']),
    }),
  )
  async adminCreateUser(
    @Req() request: AuthenticatedRequest,
    @Body() adminCreateUserDto: AdminCreateUserDto,
  ): Promise<AdminUserInfoView> {
    const user = await this.usersService.adminCreateUser(
      request.user.sub,
      adminCreateUserDto,
    );

    return toUserInfoView(user, {
      includeAdminFlags: true,
    }) as AdminUserInfoView;
  }
}
