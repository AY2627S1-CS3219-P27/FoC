import {
  Body,
  Post,
  Controller,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { ACCESS_TOKEN_COOKIE } from '@foc/contracts';
import {
  JWT_EXPIRATION_IN_SECONDS,
  REGISTRATION_TOKEN_COOKIE,
} from '../common/constants.js';
import { RegisterDto } from './DTO/register.dto.js';
import { AuthService } from './auth.service.js';
import { LoginDto } from './DTO/login.dto.js';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';

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
    const { accessToken } = await this.authService.checkCredentials(
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
    return { message: 'Logged in.' };
  }
}
