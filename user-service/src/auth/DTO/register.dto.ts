import { IsString, IsStrongPassword, Length } from 'class-validator';

export class RegisterDto {
  @IsString()
  @Length(1, 255)
  displayName: string;

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
