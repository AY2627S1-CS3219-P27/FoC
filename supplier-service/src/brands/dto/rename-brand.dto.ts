import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';

/** The name of a brand (F3.1, F3.3): 1-100 characters after trimming. */
export class RenameBrandDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 100, { message: 'name must be 1-100 characters after trimming' })
  name: string;
}
