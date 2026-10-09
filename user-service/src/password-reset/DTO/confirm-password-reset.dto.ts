import { IsString, IsStrongPassword, Length } from 'class-validator';

export class ConfirmPasswordResetDto {
  /** Reset token from the emailed link. */
  @IsString()
  @Length(1, 512)
  token: string;

  /**
   * New password, meeting the same criteria as registration (F8.3 / F3.3):
   * the only rule is a minimum length of 12.
   */
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