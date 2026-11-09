import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { RequestOtpDto } from './DTO/request-otp.dto.js';
import { ValidateOtpDto } from './DTO/validate-otp.dto.js';
import { ConfigService } from '@nestjs/config';
import { OtpService } from './otp.service.js';
import { REGISTRATION_TOKEN_COOKIE } from '../common/constants.js';
import { ApiErrorDto } from '../http/api-error.dto.js';
import { MessageResponseDto } from '../http/message-response.dto.js';
import {
  errorResponse,
  successResponse,
  validationErrorExample,
} from '../http/api-doc-helpers.js';

@ApiTags('otp')
@ApiExtraModels(ApiErrorDto, MessageResponseDto)
@ApiProduces('application/json')
@Controller('otp')
export class OtpController {
  constructor(
    private otpService: OtpService,
    private configService: ConfigService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Request an OTP for NUS email verification',
    description:
      'Sends a one-time code to the given NUS email. The response is identical whether or not the email is registered.',
  })
  @ApiBody({ type: RequestOtpDto })
  @ApiCreatedResponse(
    successResponse(
      MessageResponseDto,
      'Always returned, so the endpoint does not reveal whether the email exists.',
      { message: 'If this email is valid, an OTP has been sent.' },
    ),
  )
  @ApiBadRequestResponse(
    errorResponse('The request body violates the field constraints.', {
      ...validationErrorExample(['email must be an email']),
    }),
  )
  async request(@Body() requestOtpDto: RequestOtpDto) {
    await this.otpService.createOtpRequest(requestOtpDto.email);
    return { message: 'If this email is valid, an OTP has been sent.' };
  }

  @Post('validate')
  @ApiOperation({
    summary: 'Verify an OTP and receive a registration token',
    description:
      'On success sets the short-lived registration_token cookie consumed by POST /auth/register.',
  })
  @ApiBody({ type: ValidateOtpDto })
  @ApiCreatedResponse(
    successResponse(
      MessageResponseDto,
      'The OTP is valid; the registration_token cookie is set.',
      { message: 'OTP validated.' },
    ),
  )
  @ApiBadRequestResponse(
    errorResponse('The OTP is wrong or expired.', {
      statusCode: 400,
      message: 'Invalid OTP.',
      error: 'Bad Request',
    }),
  )
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
