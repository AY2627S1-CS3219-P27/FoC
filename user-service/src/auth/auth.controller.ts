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
    if (
      !(REGISTRATION_TOKEN_COOKIE in request.cookies) ||
      request.cookies[REGISTRATION_TOKEN_COOKIE] === undefined
    ) {
      throw new UnauthorizedException('Cookie not present.');
    }

    const record = await this.authService.registerWithToken(
      request.cookies[REGISTRATION_TOKEN_COOKIE],
      registerDto.displayName,
      registerDto.password,
    );

    if (record === null) {
      throw new UnauthorizedException('Token invalid or expired.');
    }

    return record;
  }
}
