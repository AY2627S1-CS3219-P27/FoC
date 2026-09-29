import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  IsUrl,
  Length,
  MaxLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * The authenticated user's updatable particulars. Both fields are
 * optional: only the fields present in the request are written. An explicit
 * `null` profilePictureUrl clears the stored picture (the entity column is
 * nullable); other fields reject `null` outright.
 */
export class UpdateProfileDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 255, {
    message: 'displayName must be 1-255 characters after trimming',
  })
  displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2083)
  @IsUrl(
    { require_protocol: true, protocols: ['http', 'https'] },
    { message: 'profilePictureUrl must be an http(s) URL' },
  )
  profilePictureUrl?: string | null;
}
