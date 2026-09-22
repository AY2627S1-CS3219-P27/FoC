import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { RequestOtpDto } from './DTO/RequestOtp.dto.js';
import { ValidateOtpDto } from './DTO/ValidateOtp.dto.js';
import { OtpService } from './otp.service.js';

@Controller('otp')
export class OtpController {
  constructor(private otpService: OtpService) {}
  @Post()
  async request(@Body() requestOtpDto: RequestOtpDto) {
    await this.otpService.createOtpRequest(requestOtpDto.email);
    return { message: 'If this email is valid, an OTP has been sent.' };
  }

  @Post('validate')
  async validate(@Body() validateOtpDto: ValidateOtpDto) {
    const valid = await this.otpService.validateOtp(
      validateOtpDto.email,
      validateOtpDto.otp,
    );
    if (!valid) {
      throw new BadRequestException('Invalid OTP.');
    }
    return { message: 'OTP validated.' };
  }
}
