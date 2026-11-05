import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  ChatCloseReason,
  ChatState,
} from '../database/entities/chat.entity.js';

/**
 * Deliberately deviates from N3.1.2's offset pagination: chat activity can
 * reorder rows, while message history has a stable sequence, so an opaque
 * keyset cursor avoids offset drift and supports efficient continuation.
 */
export class CursorPageQueryDto {
  @ApiPropertyOptional({ description: 'Opaque continuation cursor.' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  cursor?: string;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;
}

export class ApiErrorResponseDto {
  @ApiProperty()
  code: string;

  @ApiProperty()
  message: string;
}

export class MessageViewDto {
  @ApiProperty({ format: 'uuid' })
  messageId: string;

  @ApiProperty({ minimum: 1 })
  sequence: number;

  @ApiProperty({ format: 'uuid' })
  senderUserId: string;

  @ApiProperty()
  content: string;

  @ApiProperty({ format: 'date-time' })
  timestamp: string;

  @ApiProperty({ enum: ['UNREAD', 'READ'] })
  status: 'UNREAD' | 'READ';
}

export class ChatViewDto {
  @ApiProperty({ format: 'uuid' })
  chatId: string;

  @ApiProperty({ format: 'uuid' })
  errandId: string;

  @ApiProperty({ format: 'uuid' })
  requesterUserId: string;

  @ApiProperty({ format: 'uuid' })
  courierUserId: string;

  @ApiProperty({ enum: ['ACTIVE', 'GRACE'] })
  state: Exclude<ChatState, 'ARCHIVED'>;

  @ApiProperty({ format: 'date-time', nullable: true })
  closesAt: string | null;

  @ApiProperty({
    enum: ['ERRAND_DELIVERED', 'COURIER_CANCELLED', 'ERRAND_CANCELLED'],
    nullable: true,
  })
  closeReason: ChatCloseReason | null;

  @ApiProperty({ format: 'date-time' })
  updatedAt: string;

  @ApiProperty({ type: MessageViewDto, nullable: true })
  lastMessage: MessageViewDto | null;

  @ApiProperty()
  unread: boolean;
}

export class ChatListResponseDto {
  @ApiProperty({ type: [ChatViewDto] })
  items: ChatViewDto[];

  @ApiProperty()
  hasMore: boolean;

  @ApiProperty({ nullable: true })
  nextCursor: string | null;
}

export class MessageHistoryResponseDto {
  @ApiProperty({ type: [MessageViewDto] })
  items: MessageViewDto[];

  @ApiProperty()
  hasMore: boolean;

  @ApiProperty({ nullable: true })
  nextCursor: string | null;
}
