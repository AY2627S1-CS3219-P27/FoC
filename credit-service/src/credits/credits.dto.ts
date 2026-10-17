import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsUUID, Max, Min } from 'class-validator';
import {
  BALANCE_TYPES,
  CREDIT_TRANSACTION_TYPES,
  type BalanceType,
  type CreditTransactionType,
} from '../database/entities/credit-transaction.entity.js';
import {
  DEFAULT_PAGE_LIMIT,
  DEFAULT_PAGE_OFFSET,
  MAX_PAGE_LIMIT,
} from '@foc/contracts';

const EXAMPLE_USER_ID = '11111111-1111-4111-8111-111111111111';

export class CreditBalanceResponseDto {
  @ApiProperty({ example: EXAMPLE_USER_ID, format: 'uuid' })
  userId: string;

  @ApiProperty({ example: 100, minimum: 0 })
  creditBalance: number;

  @ApiProperty({ example: 0, minimum: 0 })
  reservedBalance: number;
}

export class CreditSufficiencyRequestDto {
  @ApiProperty({ example: EXAMPLE_USER_ID, format: 'uuid' })
  @IsUUID()
  userId: string;

  @ApiProperty({ example: 50, minimum: 1, maximum: Number.MAX_SAFE_INTEGER })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  amount: number;
}

export class CreditSufficiencyResponseDto {
  @ApiProperty({ example: EXAMPLE_USER_ID, format: 'uuid' })
  userId: string;

  @ApiProperty({ example: 50, minimum: 1, maximum: Number.MAX_SAFE_INTEGER })
  amount: number;

  @ApiProperty({ example: true })
  sufficient: boolean;
}

export class CreditTransactionHistoryQueryDto {
  @ApiPropertyOptional({
    default: DEFAULT_PAGE_OFFSET,
    minimum: 0,
    description: 'Zero-based offset into the matching transaction history.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset: number = DEFAULT_PAGE_OFFSET;

  @ApiPropertyOptional({
    default: DEFAULT_PAGE_LIMIT,
    minimum: 1,
    maximum: MAX_PAGE_LIMIT,
    description: 'Maximum number of transactions returned in this response.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_LIMIT)
  limit: number = DEFAULT_PAGE_LIMIT;
}

export class CreditTransactionParticipantDto {
  @ApiProperty({ example: EXAMPLE_USER_ID, format: 'uuid' })
  userId: string;

  @ApiProperty({ enum: BALANCE_TYPES, example: 'RESERVED_BALANCE' })
  balanceType: BalanceType;
}

export class CreditTransactionHistoryItemDto {
  @ApiProperty({ example: EXAMPLE_USER_ID, format: 'uuid' })
  transactionId: string;

  @ApiProperty({ enum: CREDIT_TRANSACTION_TYPES, example: 'TRANSFER' })
  type: CreditTransactionType;

  @ApiProperty({ example: '2026-10-17T08:00:00.000Z', format: 'date-time' })
  datetime: string;

  @ApiProperty({ example: 25, minimum: 1, maximum: Number.MAX_SAFE_INTEGER })
  amount: number;

  @ApiProperty({ example: EXAMPLE_USER_ID, format: 'uuid' })
  errandId: string;

  @ApiProperty({ type: CreditTransactionParticipantDto })
  origin: CreditTransactionParticipantDto;

  @ApiProperty({ type: CreditTransactionParticipantDto })
  destination: CreditTransactionParticipantDto;
}

export class CreditTransactionHistoryResponseDto {
  @ApiProperty({ type: [CreditTransactionHistoryItemDto] })
  items: CreditTransactionHistoryItemDto[];

  @ApiProperty({ example: 1, minimum: 0 })
  total: number;

  @ApiProperty({ example: 0, minimum: 0 })
  offset: number;

  @ApiProperty({ example: 25, minimum: 1, maximum: MAX_PAGE_LIMIT })
  limit: number;

  @ApiProperty({ example: false })
  hasMore: boolean;
}

export class ApiErrorReasonDto {
  @ApiProperty({ example: 'amount' })
  field: string;

  @ApiProperty({ example: 'must not be less than 1' })
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
