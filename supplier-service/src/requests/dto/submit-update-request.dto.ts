import { Transform } from 'class-transformer';
import { IsObject, IsUUID } from 'class-validator';

/**
 * A request to edit a supplier (F8.1). `changes` has the same fields as an
 * admin PATCH and is checked by the same rules in the service, so every
 * field problem comes back in one 400 (F1.6.1).
 */
export class SubmitUpdateRequestDto {
  // Lower-cased like every other id: PostgreSQL returns UUIDs lower-case.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsUUID()
  supplierId: string;

  @IsObject()
  changes: Record<string, unknown>;
}
