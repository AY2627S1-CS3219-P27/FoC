import { Transform, type TransformFnParams } from 'class-transformer';
import { IsEmail } from 'class-validator';

export class RequestPasswordResetDto {
  @Transform(({ value }: TransformFnParams) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsEmail()
  email: string;
}
