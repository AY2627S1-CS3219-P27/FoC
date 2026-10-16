import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import type pg from 'pg';
import { POOL } from '../db/db.module.js';

// Target of the Dockerfile HEALTHCHECK. Healthy only while Postgres answers:
// without it every transition, reply and sweep fails.
@Controller('health')
export class HealthController {
  constructor(@Inject(POOL) private readonly pool: pg.Pool) {}

  @Get()
  async check() {
    try {
      await this.pool.query('SELECT 1');
    } catch {
      throw new ServiceUnavailableException({ status: 'down' });
    }
    return { status: 'ok' };
  }
}
