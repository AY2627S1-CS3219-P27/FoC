import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

// Target of the Dockerfile HEALTHCHECK. Healthy only while the database answers:
// without it no balance read, reservation or settlement can complete.
@Controller('health')
export class HealthController {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @Get()
  async check() {
    try {
      await this.dataSource.query('SELECT 1');
    } catch {
      throw new ServiceUnavailableException({ status: 'down' });
    }
    return { status: 'ok' };
  }
}
