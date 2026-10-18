import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';

/** Denying a request requires a reason (F6.4). */
export class DenyRequestDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 500, {
    message: 'reason must be 1-500 characters after trimming',
  })
  reason: string;
}
