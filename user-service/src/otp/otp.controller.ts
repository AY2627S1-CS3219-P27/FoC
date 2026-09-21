import { Controller, Body, Post } from '@nestjs/common';
import { RequestOtpDto } from './DTO/RequestOtp.dto.js';
import { OtpService } from './otp.service.js';

@Controller('otp')
export class OtpController {
  constructor(private otpService: OtpService) {}
  @Post()
  async request(@Body() requestOtpDto: RequestOtpDto) {
    await this.otpService.createOtpRequest(requestOtpDto.email);
    return 'Received email: ' + requestOtpDto.email;
  }
}
