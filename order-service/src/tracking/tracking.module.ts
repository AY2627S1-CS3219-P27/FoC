import { Module, type OnApplicationShutdown, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTrackingStore } from './redis-tracking.provider.js';
import { StreamLimiter } from './stream-limiter.js';
import { DbErrandReader, ERRAND_READER } from './errand-reader.js';
import { RedisTrackingStore } from './redis-tracking.store.js';
import {
  DESTINATION_RESOLVER,
  NullDestinationResolver,
  OsrmRoutingProvider,
  ROUTING_PROVIDER,
} from './routing.js';
import { TRACKING_CONFIG, trackingConfigFrom, type TrackingConfig } from './tracking.config.js';
import { TrackingController } from './tracking.controller.js';
import { TrackingService } from './tracking.service.js';
import { TRACKING_STORE } from './tracking.store.js';

// DbModule is global, so the DB token needs no import.
@Module({
  controllers: [TrackingController],
  providers: [
    {
      provide: TRACKING_CONFIG,
      inject: [ConfigService],
      useFactory: trackingConfigFrom,
    },
    {
      provide: TRACKING_STORE,
      inject: [ConfigService],
      // Does not wait for Redis (see createTrackingStore).
      useFactory: (c: ConfigService) =>
        createTrackingStore({
          host: c.getOrThrow<string>('REDIS_HOST'),
          port: c.getOrThrow<number>('REDIS_PORT'),
          username: c.getOrThrow<string>('REDIS_USERNAME'),
          database: c.getOrThrow<number>('REDIS_DB_INDEX'),
        }),
    },
    {
      provide: ROUTING_PROVIDER,
      inject: [TRACKING_CONFIG],
      useFactory: (cfg: TrackingConfig) =>
        new OsrmRoutingProvider({ baseUrl: cfg.osrmBaseUrl, timeoutMs: cfg.osrmTimeoutMs }),
    },
    // No delivery coordinates exist yet; see DestinationResolver.
    { provide: DESTINATION_RESOLVER, useClass: NullDestinationResolver },
    { provide: ERRAND_READER, useClass: DbErrandReader },
    StreamLimiter,
    TrackingService,
  ],
})
export class TrackingModule implements OnApplicationShutdown {
  constructor(@Inject(TRACKING_STORE) private readonly store: RedisTrackingStore) {}

  async onApplicationShutdown() {
    await this.store.close();
  }
}
