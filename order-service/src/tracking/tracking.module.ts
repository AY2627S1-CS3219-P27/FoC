import { Logger, Module, type OnApplicationShutdown, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from 'redis';
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

// Startup tolerates a few failed connection attempts, then aborts (as in
// user-service); once connected it reconnects forever.
const MAX_STARTUP_RETRIES = 5;

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
      useFactory: async (c: ConfigService) => {
        let connectedOnce = false;
        const client = createClient({
          socket: {
            host: c.getOrThrow<string>('REDIS_HOST'),
            port: c.getOrThrow<number>('REDIS_PORT'),
            reconnectStrategy: (retries: number) =>
              !connectedOnce && retries >= MAX_STARTUP_RETRIES
                ? new Error(`Redis unreachable after ${retries} connection attempts`)
                : Math.min(2 ** retries * 50, 2000) + Math.floor(Math.random() * 200),
          },
          username: c.getOrThrow<string>('REDIS_USERNAME'),
          database: c.getOrThrow<number>('REDIS_DB_INDEX'),
        });
        client.on('error', (err: Error) =>
          Logger.error(`Redis connection error: ${err.message}`, 'TrackingStore'),
        );
        await client.connect();
        connectedOnce = true;
        return new RedisTrackingStore(client as never);
      },
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
    TrackingService,
  ],
})
export class TrackingModule implements OnApplicationShutdown {
  constructor(@Inject(TRACKING_STORE) private readonly store: RedisTrackingStore) {}

  async onApplicationShutdown() {
    await this.store.close?.();
  }
}
