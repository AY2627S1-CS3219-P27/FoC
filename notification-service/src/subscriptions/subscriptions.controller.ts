import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiQuery,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { type AuthenticatedRequest, JwtAuthGuard } from '@foc/auth';
import { Subscription } from '../database/entities/subscription.entity.js';
import {
  ACCESS_TOKEN_COOKIE_SECURITY_SCHEME,
  BEARER_SECURITY_SCHEME,
} from '../http/configure-http.js';
import {
  ApiErrorResponseDto,
  RegisterWebPushSubscriptionDto,
  SubscriptionResponseDto,
  UnregisterWebPushQueryDto,
} from './subscriptions.dto.js';
import { SubscriptionsService } from './subscriptions.service.js';

function successResponse(description: string) {
  return {
    description,
    content: {
      'application/json': {
        schema: { $ref: getSchemaPath(SubscriptionResponseDto) },
        example: {
          id: '33333333-3333-4333-8333-333333333333',
          endpoint:
            'https://fcm.googleapis.com/fcm/send/dV3n4X0EXAMPLE:APA91bH-example',
          channel: 'web_push',
          status: 'active',
          expirationTime: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      },
    },
  };
}

function errorResponse(description: string, example: Record<string, unknown>) {
  return {
    description,
    content: {
      'application/json': {
        schema: { $ref: getSchemaPath(ApiErrorResponseDto) },
        example,
      },
    },
  };
}

function toResponse(subscription: Subscription): SubscriptionResponseDto {
  return {
    id: subscription.id,
    endpoint: subscription.endpoint,
    channel: subscription.channel,
    status: subscription.status,
    expirationTime: subscription.expirationTime,
    createdAt: subscription.createdAt,
    updatedAt: subscription.updatedAt,
  };
}

@ApiTags('subscriptions')
@ApiExtraModels(ApiErrorResponseDto, SubscriptionResponseDto)
@ApiProduces('application/json')
@ApiBearerAuth(BEARER_SECURITY_SCHEME)
@ApiSecurity(ACCESS_TOKEN_COOKIE_SECURITY_SCHEME)
@ApiUnauthorizedResponse(
  errorResponse('The access token is missing or invalid.', {
    code: 'INVALID_ACCESS_TOKEN',
    message: 'Invalid access token',
  }),
)
@Controller('v1/subscriptions')
@UseGuards(JwtAuthGuard)
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Post('web')
  @ApiOperation({
    summary: 'Register a Web Push subscription',
    description:
      'Registers the browser PushSubscription for the authenticated user. Posting an endpoint that already exists for this user refreshes its keys and reactivates it; a new endpoint returns 201. The user is always the token subject — the body cannot select one.',
  })
  @ApiBody({ type: RegisterWebPushSubscriptionDto })
  @ApiCreatedResponse(successResponse('A new push endpoint was registered.'))
  @ApiOkResponse(
    successResponse(
      'The endpoint was already known and has been refreshed/reactivated.',
    ),
  )
  @ApiBadRequestResponse(
    errorResponse('The subscription payload is malformed.', {
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      reasons: [
        {
          field: 'endpoint',
          reason: 'endpoint must be a URL address',
        },
      ],
    }),
  )
  async registerWebPush(
    @Req() request: AuthenticatedRequest,
    @Body() body: RegisterWebPushSubscriptionDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SubscriptionResponseDto> {
    const result = await this.subscriptions.registerWebPush(
      request.user.sub,
      body,
    );

    response.status(result.created ? HttpStatus.CREATED : HttpStatus.OK);
    if (result.created) {
      response.location(
        `/v1/subscriptions/web?endpoint=${encodeURIComponent(
          result.subscription.endpoint,
        )}`,
      );
    }

    return toResponse(result.subscription);
  }

  @Delete('web')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Unregister a Web Push subscription',
    description:
      'Marks the (authenticated user, endpoint) row inactive. Idempotent: an unknown or already-inactive endpoint also returns 204.',
  })
  @ApiQuery({
    name: 'endpoint',
    required: true,
    type: String,
    description: 'The endpoint to deactivate for the authenticated user.',
  })
  @ApiNoContentResponse({
    description: 'The endpoint is inactive (or already was).',
  })
  @ApiBadRequestResponse(
    errorResponse('The endpoint query parameter is missing or not https.', {
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      reasons: [
        {
          field: 'endpoint',
          reason: 'endpoint must be a URL address',
        },
      ],
    }),
  )
  async unregisterWebPush(
    @Req() request: AuthenticatedRequest,
    @Query() query: UnregisterWebPushQueryDto,
  ): Promise<void> {
    await this.subscriptions.deactivateWebPush(
      request.user.sub,
      query.endpoint,
    );
  }
}
