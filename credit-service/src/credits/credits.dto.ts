import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsUUID, Max, Min } from 'class-validator';

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
