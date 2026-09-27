import { IsString, IsEmail, Length } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @Length(12, 255)
  password: string;
}
