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
import type { Request } from 'express';
import { ACCESS_TOKEN_COOKIE } from '@foc/contracts';
import {
  JWT_EXPIRATION_IN_SECONDS,
  REFRESH_TOKEN_EXPIRATION_IN_SECONDS,
  REFRESH_TOKEN_COOKIE,
  REGISTRATION_TOKEN_COOKIE,
} from '../common/constants.js';
import { RegisterDto } from './DTO/register.dto.js';
import { AuthService } from './auth.service.js';
import { LoginDto } from './DTO/login.dto.js';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { type AuthenticatedRequest, JwtAuthGuard } from '@foc/auth';

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private configService: ConfigService,
  ) {}

  @Post('register')
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
