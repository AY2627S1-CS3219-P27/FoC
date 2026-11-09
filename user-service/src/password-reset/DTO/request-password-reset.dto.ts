import { ApiProperty } from '@nestjs/swagger';
import { Transform, type TransformFnParams } from 'class-transformer';
import { IsEmail } from 'class-validator';
import { EXAMPLE_NUS_EMAIL } from '../../http/api-doc-helpers.js';

export class RequestPasswordResetDto {
  @ApiProperty({ example: EXAMPLE_NUS_EMAIL, format: 'email', maxLength: 255 })
  @Transform(({ value }: TransformFnParams) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsEmail()
  email: string;
}
