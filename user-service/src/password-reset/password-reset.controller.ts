import { Body, Controller, Post } from '@nestjs/common';
import { ConfirmPasswordResetDto } from './DTO/confirm-password-reset.dto.js';
import { RequestPasswordResetDto } from './DTO/request-password-reset.dto.js';
import { PasswordResetService } from './password-reset.service.js';

/**
 * Public endpoint. Anyone with an email may request a
 * reset link, and anyone with a valid token may redeem it.
 */
@Controller('password-reset')
export class PasswordResetController {
  constructor(private passwordResetService: PasswordResetService) {}

  @Post('request')
  async request(@Body() requestPasswordResetDto: RequestPasswordResetDto) {
    await this.passwordResetService.requestReset(requestPasswordResetDto.email);
    // Identical response for registered and unregistered emails alike.
    return {
      message: 'If this email is valid, a password reset link has been sent.',
    };
  }

  @Post('confirm')
  async confirm(@Body() confirmPasswordResetDto: ConfirmPasswordResetDto) {
    await this.passwordResetService.confirmReset(
      confirmPasswordResetDto.token,
      confirmPasswordResetDto.password,
    );
    return { message: 'Password reset.' };
  }
}
