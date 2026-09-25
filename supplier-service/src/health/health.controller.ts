import { Controller, Get } from '@nestjs/common';

/**
 * Liveness probe for the container healthcheck. It deliberately reports only
 * that the process is serving HTTP; it stays reachable without a token once
 * authentication is added (step 2).
 */
@Controller('health')
export class HealthController {
  @Get()
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
