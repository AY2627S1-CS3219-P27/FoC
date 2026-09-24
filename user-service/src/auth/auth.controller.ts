import {
  Body,
  Post,
  Controller,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { REGISTRATION_TOKEN_COOKIE } from '../common/constants.js';
import { RegisterDto } from './DTO/Register.dto.js';
import { AuthService } from './auth.service.js';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

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
}
