import { ApiProperty } from '@nestjs/swagger';
import { Transform, type TransformFnParams } from 'class-transformer';
import { IsEmail } from 'class-validator';
import { EXAMPLE_NUS_EMAIL } from '../../http/api-doc-helpers.js';
import { IsNusEmail } from '../../common/validators/is-nus-email.validator.js';

export class RequestOtpDto {
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
}
