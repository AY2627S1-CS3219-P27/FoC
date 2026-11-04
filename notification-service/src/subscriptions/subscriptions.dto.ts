import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  SubscriptionChannel,
  SubscriptionStatus,
} from '../database/entities/subscription.entity.js';

const EXAMPLE_ENDPOINT =
  'https://fcm.googleapis.com/fcm/send/dV3n4X0EXAMPLE:APA91bH-example';

export class WebPushKeysDto {
  @ApiProperty({
    description: 'P-256 public key from the browser PushSubscription.',
    example:
      'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM',
    maxLength: 255,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  p256dh: string;

  @ApiProperty({
    description: 'Authentication secret from the browser PushSubscription.',
    example: 'tBHItJI5svbpez7KI4CCXg',
    maxLength: 255,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  auth: string;
}

/**
 * The browser's PushSubscription JSON, posted verbatim:
 * `JSON.stringify(subscription)` fits this shape.
 */
export class RegisterWebPushSubscriptionDto {
  @ApiProperty({
    description:
      'Push service endpoint URL. Must be https; it is the natural key together with the caller.',
    example: EXAMPLE_ENDPOINT,
    maxLength: 2048,
  })
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(2048)
  endpoint: string;

  @ApiProperty({ type: WebPushKeysDto })
  @ValidateNested()
  @Type(() => WebPushKeysDto)
  keys: WebPushKeysDto;

  @ApiPropertyOptional({
    description:
      'PushSubscription.expirationTime (epoch milliseconds). Omit or send null when the subscription does not expire.',
    example: null,
    nullable: true,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  expirationTime?: number | null;
}

export class UnregisterWebPushQueryDto {
  @ApiProperty({
    description: 'The endpoint to deactivate for the authenticated user.',
    example: EXAMPLE_ENDPOINT,
    maxLength: 2048,
  })
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(2048)
  endpoint: string;
}

export class ApiErrorReasonDto {
  @ApiProperty({ example: 'endpoint' })
  field: string;

  @ApiProperty({ example: 'endpoint must be a URL address' })
  reason: string;
}

export class ApiErrorResponseDto {
  @ApiProperty({ example: 'VALIDATION_ERROR' })
  code: string;

  @ApiProperty({ example: 'Request validation failed' })
  message: string;

  @ApiPropertyOptional({ type: [ApiErrorReasonDto] })
  reasons?: ApiErrorReasonDto[];
}

export class SubscriptionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: EXAMPLE_ENDPOINT })
  endpoint: string;

  @ApiProperty({ enum: SubscriptionChannel, enumName: 'SubscriptionChannel' })
  channel: SubscriptionChannel;

  @ApiProperty({ enum: SubscriptionStatus, enumName: 'SubscriptionStatus' })
  status: SubscriptionStatus;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
    example: null,
  })
  expirationTime: Date | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt: Date;
}
