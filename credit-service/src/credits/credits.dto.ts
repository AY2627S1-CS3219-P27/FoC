import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

const MAX_POSTGRES_INTEGER = 2_147_483_647;

export class CreditBalanceResponseDto {
  @ApiProperty({ example: 7, minimum: 1, maximum: MAX_POSTGRES_INTEGER })
  userId: number;

  @ApiProperty({ example: 100, minimum: 0 })
  creditBalance: number;

  @ApiProperty({ example: 0, minimum: 0 })
  reservedBalance: number;
}

export class CreditSufficiencyRequestDto {
  @ApiProperty({ example: 7, minimum: 1, maximum: MAX_POSTGRES_INTEGER })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_POSTGRES_INTEGER)
  userId: number;

  @ApiProperty({ example: 50, minimum: 1, maximum: Number.MAX_SAFE_INTEGER })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  amount: number;
}

export class CreditSufficiencyResponseDto {
  @ApiProperty({ example: 7, minimum: 1, maximum: MAX_POSTGRES_INTEGER })
  userId: number;

  @ApiProperty({ example: 50, minimum: 1, maximum: Number.MAX_SAFE_INTEGER })
  amount: number;

  @ApiProperty({ example: true })
  sufficient: boolean;
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
