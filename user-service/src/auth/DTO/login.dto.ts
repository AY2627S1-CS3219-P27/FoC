import { Transform, type TransformFnParams } from 'class-transformer';
import { IsString, IsEmail, Length } from 'class-validator';

export class LoginDto {
  // Lowercased so a login matches the account email stored in lowercase.
  @Transform(({ value }: TransformFnParams) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsEmail()
  email: string;

  @IsString()
  @Length(12, 255)
  password: string;
}
