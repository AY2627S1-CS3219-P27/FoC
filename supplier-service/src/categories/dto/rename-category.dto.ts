import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';

/** The new name of a category (F11.2); same rules as when creating one. */
export class RenameCategoryDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 50, { message: 'name must be 1-50 characters after trimming' })
  name: string;
}
