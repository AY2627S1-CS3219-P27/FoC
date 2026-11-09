import { ApiProperty } from '@nestjs/swagger';
import {
  EXAMPLE_NUS_EMAIL,
  EXAMPLE_USER_ID,
} from '../../http/api-doc-helpers.js';

/** The account summary returned after a successful registration. */
export class RegisteredUserDto {
  @ApiProperty({ example: EXAMPLE_USER_ID, format: 'uuid' })
  uuid: string;

  @ApiProperty({ example: EXAMPLE_NUS_EMAIL, format: 'email' })
  email: string;

  @ApiProperty({ example: 'Alex Teo' })
  displayName: string;
}
