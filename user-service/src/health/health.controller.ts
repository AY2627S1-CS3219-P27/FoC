import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

// Target of the Dockerfile HEALTHCHECK. Healthy only while the database answers:
// without it every request, OTP verification and audit write fails.
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @Get()
  @ApiOkResponse({
    description: 'The database answers queries.',
    content: { 'application/json': { example: { status: 'ok' } } },
  })
  @ApiServiceUnavailableResponse({
    description: 'The database does not answer queries.',
    content: { 'application/json': { example: { status: 'down' } } },
  })
  async check() {
    try {
      await this.dataSource.query('SELECT 1');
    } catch {
      throw new ServiceUnavailableException({ status: 'down' });
    }
    return { status: 'ok' };
  }
}
