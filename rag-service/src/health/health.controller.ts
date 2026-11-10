import { Controller, Get } from '@nestjs/common';

/**
 * Liveness probe for the container healthcheck. It deliberately reports only
 * that the process is serving HTTP, and needs no token. A database or
 * OpenRouter outage must not mark the container unhealthy: questions answer
 * 503 instead, and CI's stack test can start the service with a stub key.
 */
@Controller('health')
export class HealthController {
  @Get()
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
