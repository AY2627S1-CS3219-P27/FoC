import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Mirrors the JSON body Nest's default exception filter produces for this
 * service's errors: string-message exceptions become `statusCode`, `message`
 * and `error`, while ValidationPipe failures put the constraint messages in a
 * `message` array.
 */
export class ApiErrorDto {
  @ApiProperty({ example: 400 })
  statusCode: number;

  @ApiProperty({
    example: ['email must be an email'],
    description:
      'Constraint message(s). A string for most exceptions, an array for ValidationPipe failures.',
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
  })
  message: string | string[];

  @ApiPropertyOptional({ example: 'Bad Request' })
  error?: string;
}
