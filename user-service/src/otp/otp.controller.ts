import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { RequestOtpDto } from './DTO/RequestOtp.dto.js';
import { ValidateOtpDto } from './DTO/ValidateOtp.dto.js';
import { ConfigService } from '@nestjs/config';
import { OtpService } from './otp.service.js';
import { REGISTRATION_TOKEN_COOKIE } from '../common/constants.js';

@Controller('otp')
export class OtpController {
  constructor(
    private otpService: OtpService,
    private configService: ConfigService,
  ) {}
  @Post()
  async request(@Body() requestOtpDto: RequestOtpDto) {
    await this.otpService.createOtpRequest(requestOtpDto.email);
    return { message: 'If this email is valid, an OTP has been sent.' };
  }

  @Post('validate')
  async validate(
    @Body() validateOtpDto: ValidateOtpDto,
    // passthrough: true to allow full (express) library control over
    // handling the response cookie object, as per documentation
    @Res({ passthrough: true }) res: Response,
  ) {
    const issued = await this.otpService.validateOtpAndIssueToken(
      validateOtpDto.email,
      validateOtpDto.otp,
    );
    if (!issued) {
      throw new BadRequestException('Invalid OTP.');
    }

    res.cookie(REGISTRATION_TOKEN_COOKIE, issued.token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: issued.validForSeconds * 1000, // Convert validForSeconds into milliseconds
      secure: this.configService.get('NODE_ENV') === 'production',
    });
    return { message: 'OTP validated.' };
  }
}
