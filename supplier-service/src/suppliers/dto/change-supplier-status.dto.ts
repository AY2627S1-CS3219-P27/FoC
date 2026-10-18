import { IsEnum } from 'class-validator';
import { SupplierStatus } from '../../database/entities/index.js';

export class ChangeSupplierStatusDto {
  @IsEnum(SupplierStatus, {
    message: `status must be one of ${Object.values(SupplierStatus).join(', ')}`,
  })
  status: SupplierStatus;
}
