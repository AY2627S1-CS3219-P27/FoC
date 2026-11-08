import { readFileSync } from 'node:fs';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type CampusContains, parseCampusBoundary } from './campus-boundary.js';

export const CAMPUS_CONTAINS = Symbol('CAMPUS_CONTAINS');

// Loaded once at boot from CAMPUS_BOUNDARY_PATH; a missing or bad file stops the service.
@Module({
  providers: [
    {
      provide: CAMPUS_CONTAINS,
      inject: [ConfigService],
      useFactory: (c: ConfigService): CampusContains =>
        parseCampusBoundary(JSON.parse(readFileSync(c.getOrThrow('CAMPUS_BOUNDARY_PATH'), 'utf8'))),
    },
  ],
  exports: [CAMPUS_CONTAINS],
})
export class CampusModule {}
