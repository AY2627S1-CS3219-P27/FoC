import { Transform, type TransformFnParams } from 'class-transformer';
import { IsEmail, IsString, Length } from 'class-validator';

export class ValidateOtpDto {
  @Transform(({ value }: TransformFnParams) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsEmail()
  email: string;

  // Deliberately loose (any 6 chars): malformed OTPs must reach the same
  // opaque rejection as genuinely-invalid ones, so the format layer never
  // distinguishes failure reasons.
  @IsString()
  @Length(6, 6)
  otp: string;
}
