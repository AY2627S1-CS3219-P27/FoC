import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiNoContentResponse,
  ApiNotFoundResponse,
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
  UpdateWebPushSubscriptionDto,
  VapidPublicKeyResponseDto,
  WebPushEndpointQueryDto,
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
@ApiExtraModels(
  ApiErrorResponseDto,
  SubscriptionResponseDto,
  VapidPublicKeyResponseDto,
)
@ApiProduces('application/json')
@Controller('v1/subscriptions')
export class SubscriptionsController {
  private readonly vapidPublicKey: string;

  constructor(
    private readonly subscriptions: SubscriptionsService,
    config: ConfigService,
  ) {
    // Validated by the environment schema at boot; a missing key must not
    // surface lazily as a confusing subscribe failure in the browser.
    this.vapidPublicKey = config.getOrThrow<string>('VAPID_PUBLIC_KEY');
  }

  /**
   * Public by design: the VAPID public key is handed to every browser that
   * subscribes, and the private half never leaves the sending side.
   */
  @Get('vapid-public-key')
  @ApiOperation({
    summary: 'Get the VAPID public key',
    description:
      'The base64url key a browser passes as applicationServerKey when calling pushManager.subscribe. Public information; no token required.',
  })
  @ApiOkResponse({
    description: 'The VAPID public key for push subscriptions.',
    content: {
      'application/json': {
        schema: { $ref: getSchemaPath(VapidPublicKeyResponseDto) },
        example: {
          publicKey:
            'BCwlfM3d0eD3zBSTPRk3OhG-Xux7zbEumbHGLFOLdYh8CPG35a0Ws0BaMwe7F8R6CGHy03EnOSiRkw3BHzHJuoI',
        },
      },
    },
  })
  getVapidPublicKey(): VapidPublicKeyResponseDto {
    return { publicKey: this.vapidPublicKey };
  }

  @Post('web')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth(BEARER_SECURITY_SCHEME)
  @ApiSecurity(ACCESS_TOKEN_COOKIE_SECURITY_SCHEME)
  @ApiUnauthorizedResponse(
    errorResponse('The access token is missing or invalid.', {
      code: 'INVALID_ACCESS_TOKEN',
      message: 'Invalid access token',
    }),
  )
  @ApiOperation({
    summary: 'Create a Web Push subscription',
    description:
      'Creates the subscription for a new endpoint owned by the authenticated user. An endpoint that already exists for this user is a conflict — re-present a live subscription with PATCH instead. An endpoint held by another account is taken over atomically (the previous row is deactivated): a Web Push endpoint belongs to the browser, so whoever is signed in owns its notifications. The user is always the token subject: the body cannot select one.',
  })
  @ApiBody({ type: RegisterWebPushSubscriptionDto })
  @ApiCreatedResponse(successResponse('A new push endpoint was registered.'))
  @ApiConflictResponse(
    errorResponse('The authenticated user already registered this endpoint.', {
      code: 'SUBSCRIPTION_ALREADY_EXISTS',
      message: 'A subscription for this endpoint already exists',
    }),
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
  async createWebPush(
    @Req() request: AuthenticatedRequest,
    @Body() body: RegisterWebPushSubscriptionDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SubscriptionResponseDto> {
    const subscription = await this.subscriptions.createWebPush(
      request.user.sub,
      body,
    );

    response.location(
      `/v1/subscriptions/web?endpoint=${encodeURIComponent(
        subscription.endpoint,
      )}`,
    );

    return toResponse(subscription);
  }

  @Patch('web')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth(BEARER_SECURITY_SCHEME)
  @ApiSecurity(ACCESS_TOKEN_COOKIE_SECURITY_SCHEME)
  @ApiUnauthorizedResponse(
    errorResponse('The access token is missing or invalid.', {
      code: 'INVALID_ACCESS_TOKEN',
      message: 'Invalid access token',
    }),
  )
  @ApiOperation({
    summary: 'Update or reactivate a Web Push subscription',
    description:
      'Reconciles the stored row with a live subscription the browser re-presented: status "active" reactivates a soft-deleted row, fresh keys/expirationTime overwrite the stored credentials. Reactivating also deactivates another account\'s row for the same endpoint, since the endpoint belongs to the browser. Omitted fields are left unchanged; the endpoint itself is immutable.',
  })
  @ApiQuery({
    name: 'endpoint',
    required: true,
    type: String,
    description: 'The endpoint to update for the authenticated user.',
  })
  @ApiBody({ type: UpdateWebPushSubscriptionDto })
  @ApiOkResponse(successResponse('The stored subscription after the update.'))
  @ApiNotFoundResponse(
    errorResponse('No subscription exists for this endpoint.', {
      code: 'SUBSCRIPTION_NOT_FOUND',
      message: 'No subscription exists for this endpoint',
    }),
  )
  @ApiBadRequestResponse(
    errorResponse('The update payload is empty or malformed.', {
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      reasons: [
        {
          field: 'hasUpdate',
          reason:
            'at least one of status, keys or expirationTime must be provided',
        },
      ],
    }),
  )
  async updateWebPush(
    @Req() request: AuthenticatedRequest,
    @Query() query: WebPushEndpointQueryDto,
    @Body() body: UpdateWebPushSubscriptionDto,
  ): Promise<SubscriptionResponseDto> {
    const subscription = await this.subscriptions.updateWebPush(
      request.user.sub,
      query.endpoint,
      body,
    );

    return toResponse(subscription);
  }

  @Delete('web')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth(BEARER_SECURITY_SCHEME)
  @ApiSecurity(ACCESS_TOKEN_COOKIE_SECURITY_SCHEME)
  @ApiUnauthorizedResponse(
    errorResponse('The access token is missing or invalid.', {
      code: 'INVALID_ACCESS_TOKEN',
      message: 'Invalid access token',
    }),
  )
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
    @Query() query: WebPushEndpointQueryDto,
  ): Promise<void> {
    await this.subscriptions.deactivateWebPush(
      request.user.sub,
      query.endpoint,
    );
  }
}
