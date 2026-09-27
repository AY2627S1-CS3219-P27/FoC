import { IsEmail } from 'class-validator';
import { IsNusEmail } from '../../common/validators/is-nus-email.validator.js';

export class RequestOtpDto {
  @IsEmail()
  @IsNusEmail()
  email: string;
}
