import { IsEmail, IsString, Length } from 'class-validator';

export class ValidateOtpDto {
  @IsEmail()
  email: string;

  // Deliberately loose (any 6 chars): malformed OTPs must reach the same
  // opaque rejection as genuinely-invalid ones, so the format layer never
  // distinguishes F1.4 outcomes.
  @IsString()
  @Length(6, 6)
  otp: string;
}
