import { ApiProperty } from '@nestjs/swagger';

/** The `{ message }` body every status-only endpoint in this service returns. */
export class MessageResponseDto {
  @ApiProperty({ example: 'Logged in.' })
  message: string;
}
