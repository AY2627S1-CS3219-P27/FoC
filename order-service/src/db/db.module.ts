import { readFileSync } from 'node:fs';
import {
  Global,
  Inject,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type { Db } from '../lifecycle/transition.js';

export const DB = Symbol('DB');
const POOL = Symbol('POOL');

@Global()
@Module({
  providers: [
    {
      provide: POOL,
      inject: [ConfigService],
      useFactory: (c: ConfigService) =>
        new pg.Pool({
          host: c.getOrThrow('DB_HOST'),
          port: c.getOrThrow<number>('DB_PORT'),
          user: c.getOrThrow('DB_USERNAME'),
          database: c.getOrThrow('DB_DATABASE'),
          password: readFileSync(
            c.getOrThrow('DB_PASSWORD_FILE'),
            'utf8',
          ).trim(),
        }),
    },
    {
      provide: DB,
      inject: [POOL],
      useFactory: (pool: pg.Pool): Db => drizzle(pool),
    },
  ],
  exports: [DB],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(POOL) private readonly pool: pg.Pool) {}
  onApplicationShutdown() {
    return this.pool.end();
  }
}
