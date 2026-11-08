import {
  Body,
  Delete,
  Post,
  Controller,
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
  ApiExtraModels,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { ACCESS_TOKEN_COOKIE } from '@foc/contracts';
import {
  JWT_EXPIRATION_IN_SECONDS,
  REFRESH_TOKEN_EXPIRATION_IN_SECONDS,
  REFRESH_TOKEN_COOKIE,
  REGISTRATION_TOKEN_COOKIE,
} from '../common/constants.js';
import {
  BEARER_SECURITY_SCHEME,
  ACCESS_TOKEN_COOKIE_SECURITY_SCHEME,
  REFRESH_TOKEN_COOKIE_SECURITY_SCHEME,
  REGISTRATION_TOKEN_COOKIE_SECURITY_SCHEME,
} from '../http/configure-http.js';
import { ApiErrorDto } from '../http/api-error.dto.js';
import { MessageResponseDto } from '../http/message-response.dto.js';
import {
  errorResponse,
  EXAMPLE_NUS_EMAIL,
  EXAMPLE_USER_ID,
  successResponse,
  validationErrorExample,
} from '../http/api-doc-helpers.js';
import { RegisterDto } from './DTO/register.dto.js';
import { AuthService } from './auth.service.js';
import { LoginDto } from './DTO/login.dto.js';
import { RegisteredUserDto } from './DTO/registered-user.dto.js';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { type AuthenticatedRequest, JwtAuthGuard } from '@foc/auth';

@ApiTags('auth')
@ApiExtraModels(ApiErrorDto, MessageResponseDto, RegisteredUserDto)
@ApiProduces('application/json')
@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private configService: ConfigService,
  ) {}

  @Post('register')
  @ApiOperation({
    summary: 'Complete registration from a verified OTP session',
    description:
      'Requires the registration_token cookie issued by POST /otp/validate. ' +
      'Consumes the token and provisions the account for its bound email.',
  })
  @ApiSecurity(REGISTRATION_TOKEN_COOKIE_SECURITY_SCHEME)
  @ApiBody({ type: RegisterDto })
  @ApiCreatedResponse(
    successResponse(RegisteredUserDto, 'The account was created.', {
      uuid: EXAMPLE_USER_ID,
      email: EXAMPLE_NUS_EMAIL,
      displayName: 'Alex Teo',
    }),
  )
  @ApiUnauthorizedResponse(
    errorResponse(
      'The registration token cookie is missing, invalid or expired.',
      {
        statusCode: 401,
        message: 'Invalid Registration Token',
        error: 'Unauthorized',
      },
    ),
  )
  @ApiConflictResponse(
    errorResponse("The token's bound email is already registered.", {
      statusCode: 409,
      message: 'Email is already registered.',
      error: 'Conflict',
    }),
  )
  @ApiBadRequestResponse(
    errorResponse('The request body violates the field constraints.', {
      ...validationErrorExample([
        'password must be longer than or equal to 12 characters',
      ]),
    }),
  )
  async register(@Req() request: Request, @Body() registerDto: RegisterDto) {
    if (!(REGISTRATION_TOKEN_COOKIE in request.cookies)) {
      throw new UnauthorizedException('Cookie not present.');
    }

    const token = request.cookies[REGISTRATION_TOKEN_COOKIE];
    if (typeof token !== 'string' || token.length === 0) {
      throw new UnauthorizedException('Missing registration token');
    }

    return this.authService.registerWithToken(
      request.cookies[REGISTRATION_TOKEN_COOKIE],
      registerDto.displayName,
      registerDto.password,
    );
  }

  @Post('login')
  @ApiOperation({
    summary: 'Log in with email and password',
    description:
      'On success sets the httpOnly access_token and refresh_token cookies.',
  })
  @ApiBody({ type: LoginDto })
  @ApiOkResponse(
    successResponse(MessageResponseDto, 'Login succeeded; cookies are set.', {
      message: 'Logged in.',
    }),
  )
  @ApiUnauthorizedResponse(
    errorResponse('The email and password do not match an account.', {
      statusCode: 401,
      message: 'Unauthorized',
      error: 'Unauthorized',
    }),
  )
  @ApiBadRequestResponse(
    errorResponse('The request body violates the field constraints.', {
      ...validationErrorExample(),
    }),
  )
  async login(
    @Body() loginDto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    // login
    const { accessToken, refreshToken } =
      await this.authService.checkCredentials(
        loginDto.email,
        loginDto.password,
      );

    res.cookie(ACCESS_TOKEN_COOKIE, accessToken, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: JWT_EXPIRATION_IN_SECONDS * 1000, // seconds -> milliseconds
      secure: this.configService.get('NODE_ENV') === 'production',
    });

    // Unscoped: the browser-visible path may differ from this service's routes
    // when a proxy rewrites the prefix (e.g. /api/auth -> /auth), so a scoped
    // path would never match and the cookie would never be sent back.
    res.cookie(REFRESH_TOKEN_COOKIE, refreshToken, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: REFRESH_TOKEN_EXPIRATION_IN_SECONDS * 1000, // seconds -> milliseconds
      secure: this.configService.get('NODE_ENV') === 'production',
    });

    return { message: 'Logged in.' };
  }

  @Delete('sessions/current')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Log out of the current session',
    description:
      'Revokes the presented refresh token (if any) and clears both session cookies.',
  })
  @ApiBearerAuth(BEARER_SECURITY_SCHEME)
  @ApiSecurity(ACCESS_TOKEN_COOKIE_SECURITY_SCHEME)
  @ApiOkResponse(
    successResponse(MessageResponseDto, 'The current session is revoked.', {
      message: 'Logged out.',
    }),
  )
  async logout(
    @Res({ passthrough: true }) res: Response,
    @Req() request: AuthenticatedRequest,
  ) {
    const refreshToken = request.cookies[REFRESH_TOKEN_COOKIE];
    if (typeof refreshToken === 'string' && refreshToken.length > 0) {
      await this.authService.revokeRefreshToken(refreshToken);
    }

    this.clearCookies(res);

    return { message: 'Logged out.' };
  }

  @Delete('sessions')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Log out of every session',
    description:
      "Revokes all of the authenticated user's refresh tokens and clears both session cookies.",
  })
  @ApiBearerAuth(BEARER_SECURITY_SCHEME)
  @ApiSecurity(ACCESS_TOKEN_COOKIE_SECURITY_SCHEME)
  @ApiOkResponse(
    successResponse(MessageResponseDto, 'All sessions are revoked.', {
      message: 'Logged out of all devices.',
    }),
  )
  async logoutAll(
    @Res({ passthrough: true }) res: Response,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.authService.revokeAllRefreshTokens(request.user.sub);

    this.clearCookies(res);

    return { message: 'Logged out of all devices.' };
  }

  private clearCookies(res: Response) {
    res.clearCookie(ACCESS_TOKEN_COOKIE, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: this.configService.get('NODE_ENV') === 'production',
    });

    res.clearCookie(REFRESH_TOKEN_COOKIE, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: this.configService.get('NODE_ENV') === 'production',
    });
  }

  @Post('refresh')
  @ApiOperation({
    summary: 'Renew the access token',
    description:
      'Requires the refresh_token cookie from a previous login. On success re-sets the access_token cookie.',
  })
  @ApiSecurity(REFRESH_TOKEN_COOKIE_SECURITY_SCHEME)
  @ApiOkResponse(
    successResponse(
      MessageResponseDto,
      'The access token cookie was renewed.',
      {
        message: 'Access token renewed.',
      },
    ),
  )
  @ApiUnauthorizedResponse(
    errorResponse('The refresh token cookie is missing, invalid or expired.', {
      statusCode: 401,
      message: 'Invalid refresh token',
      error: 'Unauthorized',
    }),
  )
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!(REFRESH_TOKEN_COOKIE in request.cookies)) {
      throw new UnauthorizedException('Cookie not present.');
    }

    const token = request.cookies[REFRESH_TOKEN_COOKIE];
    if (typeof token !== 'string' || token.length === 0) {
      throw new UnauthorizedException('Missing refresh token');
    }

    const { accessToken } = await this.authService.refreshSession(token);

    res.cookie(ACCESS_TOKEN_COOKIE, accessToken, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: JWT_EXPIRATION_IN_SECONDS * 1000, // seconds -> milliseconds
      secure: this.configService.get('NODE_ENV') === 'production',
    });

    return { message: 'Access token renewed.' };
  }
}
