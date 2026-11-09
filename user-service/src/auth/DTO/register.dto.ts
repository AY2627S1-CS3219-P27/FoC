import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsStrongPassword, Length } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'Alex Teo', minLength: 1, maxLength: 255 })
  @IsString()
  @Length(1, 255)
  displayName: string;

  @ApiProperty({
    example: 'correct-horse-battery',
    description: 'Minimum length 12.',
    minLength: 12,
    maxLength: 255,
  })
  @IsStrongPassword({
    minLength: 12,
    minNumbers: 0,
    minLowercase: 0,
    minUppercase: 0,
    minSymbols: 0,
  })
  @Length(12, 255)
  password: string;
}
