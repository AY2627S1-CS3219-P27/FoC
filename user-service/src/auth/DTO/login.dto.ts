import { ApiProperty } from '@nestjs/swagger';
import { Transform, type TransformFnParams } from 'class-transformer';
import { IsString, IsEmail, Length } from 'class-validator';
import { EXAMPLE_NUS_EMAIL } from '../../http/api-doc-helpers.js';

export class LoginDto {
  // Lowercased so a login matches the account email stored in lowercase.
  @ApiProperty({ example: EXAMPLE_NUS_EMAIL, format: 'email', maxLength: 255 })
  @Transform(({ value }: TransformFnParams) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsEmail()
  email: string;

  @ApiProperty({
    example: 'correct-horse-battery',
    minLength: 12,
    maxLength: 255,
  })
  @IsString()
  @Length(12, 255)
  password: string;
}
