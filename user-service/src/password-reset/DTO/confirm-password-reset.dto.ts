import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsStrongPassword, Length } from 'class-validator';

export class ConfirmPasswordResetDto {
  /** Reset token from the emailed link. */
  @ApiProperty({
    example: '9f1c2b7a-4d3e-4f5a-9b8c-1d2e3f4a5b6c',
    minLength: 1,
    maxLength: 512,
    description: 'Reset token from the emailed link.',
  })
  @IsString()
  @Length(1, 512)
  token: string;

  /**
   * New password, meeting the same criteria as registration (F8.3 / F3.3):
   * the only rule is a minimum length of 12.
   */
  @ApiProperty({
    example: 'correct-horse-battery',
    minLength: 12,
    maxLength: 255,
    description: 'Minimum length 12.',
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
