import { Transform, type TransformFnParams } from 'class-transformer';
import { IsEmail } from 'class-validator';
import { IsNusEmail } from '../../common/validators/is-nus-email.validator.js';

export class RequestOtpDto {
  @Transform(({ value }: TransformFnParams) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsEmail()
  @IsNusEmail()
  email: string;
}
