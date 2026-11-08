import { ApiProperty } from '@nestjs/swagger';
import { Transform, type TransformFnParams } from 'class-transformer';
import { IsEmail, IsString, Length } from 'class-validator';
import { EXAMPLE_NUS_EMAIL } from '../../http/api-doc-helpers.js';
import { IsNusEmail } from '../../common/validators/is-nus-email.validator.js';

export class ValidateOtpDto {
  @ApiProperty({
    example: EXAMPLE_NUS_EMAIL,
    format: 'email',
    description: 'Must be an NUS email address.',
  })
  @Transform(({ value }: TransformFnParams) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsEmail()
  @IsNusEmail()
  email: string;

  // Deliberately loose (any 6 chars): malformed OTPs must reach the same
  // opaque rejection as genuinely-invalid ones, so the format layer never
  // distinguishes failure reasons.
  @ApiProperty({
    example: '482913',
    minLength: 6,
    maxLength: 6,
    description: 'The 6-character OTP from the email.',
  })
  @IsString()
  @Length(6, 6)
  otp: string;
}
