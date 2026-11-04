import { Controller, Get } from '@nestjs/common';

// Target of the Dockerfile HEALTHCHECK. Upgraded to a database ping once the
// TypeORM module lands (mirrors user-service's health controller).
@Controller('health')
export class HealthController {
  @Get()
  async check() {
    return { status: 'ok' };
  }
}
