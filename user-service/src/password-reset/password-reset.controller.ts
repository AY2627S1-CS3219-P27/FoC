import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { ConfirmPasswordResetDto } from './DTO/confirm-password-reset.dto.js';
import { RequestPasswordResetDto } from './DTO/request-password-reset.dto.js';
import { PasswordResetService } from './password-reset.service.js';
import { ApiErrorDto } from '../http/api-error.dto.js';
import { MessageResponseDto } from '../http/message-response.dto.js';
import {
  errorResponse,
  successResponse,
  validationErrorExample,
} from '../http/api-doc-helpers.js';

/**
 * Public endpoint. Anyone with an email may request a
 * reset link, and anyone with a valid token may redeem it.
 */
@ApiTags('password-reset')
@ApiExtraModels(ApiErrorDto, MessageResponseDto)
@ApiProduces('application/json')
@Controller('password-reset')
export class PasswordResetController {
  constructor(private passwordResetService: PasswordResetService) {}

  @Post('request')
  @ApiOperation({
    summary: 'Request a password reset link',
    description:
      'Identical response for registered and unregistered emails alike, so the endpoint does not reveal which emails exist.',
  })
  @ApiBody({ type: RequestPasswordResetDto })
  @ApiCreatedResponse(
    successResponse(
      MessageResponseDto,
      'Always returned, so the endpoint does not reveal whether the email exists.',
      {
        message: 'If this email is valid, a password reset link has been sent.',
      },
    ),
  )
  @ApiBadRequestResponse(
    errorResponse('The request body violates the field constraints.', {
      ...validationErrorExample(['email must be an email']),
    }),
  )
  async request(@Body() requestPasswordResetDto: RequestPasswordResetDto) {
    await this.passwordResetService.requestReset(requestPasswordResetDto.email);
    // Identical response for registered and unregistered emails alike.
    return {
      message: 'If this email is valid, a password reset link has been sent.',
    };
  }

  @Post('confirm')
  @ApiOperation({
    summary: 'Confirm a password reset with a token',
    description: 'Sets the account password to the supplied value.',
  })
  @ApiBody({ type: ConfirmPasswordResetDto })
  @ApiCreatedResponse(
    successResponse(MessageResponseDto, 'The password was reset.', {
      message: 'Password reset.',
    }),
  )
  @ApiBadRequestResponse(
    errorResponse('The reset token is invalid or expired.', {
      statusCode: 400,
      message: 'Invalid or expired reset token.',
      error: 'Bad Request',
    }),
  )
  async confirm(@Body() confirmPasswordResetDto: ConfirmPasswordResetDto) {
    await this.passwordResetService.confirmReset(
      confirmPasswordResetDto.token,
      confirmPasswordResetDto.password,
    );
    return { message: 'Password reset.' };
  }
}
