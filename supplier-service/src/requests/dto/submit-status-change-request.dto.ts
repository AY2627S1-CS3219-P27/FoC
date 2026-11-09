import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { SupplierStatus } from '../../database/entities/index.js';

/**
 * A request to activate or deactivate a supplier (F9.3): the target supplier,
 * the status wanted, and an optional reason.
 */
export class SubmitStatusChangeRequestDto {
  // Lower-cased like every other id: PostgreSQL returns UUIDs lower-case.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsUUID()
  supplierId: string;

  @IsEnum(SupplierStatus, {
    message: `status must be one of ${Object.values(SupplierStatus).join(', ')}`,
  })
  status: SupplierStatus;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 500, { message: 'reason must be 1-500 characters after trimming' })
  reason?: string;
}
