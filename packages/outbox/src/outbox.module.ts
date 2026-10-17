import {
  Module,
  type DynamicModule,
  type FactoryProvider,
  type ModuleMetadata,
  type Provider,
} from '@nestjs/common';
import { amqpConnectionProvider } from './amqp-connection.provider.js';
import { OUTBOX_OPTIONS, type OutboxOptions } from './outbox.options.js';
import { OutboxRelayLifecycle } from './outbox-relay.lifecycle.js';
import { OutboxRelay } from './outbox.relay.js';
import { OutboxStore } from './outbox.store.js';
import { RabbitMqOutboxPublisher } from './rabbitmq-outbox.publisher.js';

export interface OutboxModuleAsyncOptions {
  /**
   * Modules to import so the injected dependencies (e.g. a secret service for
   * the RabbitMQ password, or the shared connection URL provider) resolve.
   */
  imports?: ModuleMetadata['imports'];
  inject?: FactoryProvider['inject'];
  useFactory: (...args: any[]) => OutboxOptions | Promise<OutboxOptions>;
}

/**
 * Registers the shared transactional outbox: a relay that polls the service's
 * `outbox_events` table and publishes committed envelopes through a dedicated
 * RabbitMQ confirm channel.
 *
 * The consuming service owns the `outbox_events` table (via its TypeORM entity
 * registration and migrations) and the `OUTBOX_*` environment knobs. This
 * module only wires the relay, store, publisher, and lifecycle.
 */
@Module({})
export class OutboxModule {
  static forRootAsync(options: OutboxModuleAsyncOptions): DynamicModule {
    const optionsProvider: Provider = {
      provide: OUTBOX_OPTIONS,
      useFactory: options.useFactory,
      inject: options.inject ?? [],
    };

    return {
      module: OutboxModule,
      imports: options.imports ?? [],
      providers: [
        optionsProvider,
        amqpConnectionProvider,
        OutboxStore,
        RabbitMqOutboxPublisher,
        OutboxRelay,
        OutboxRelayLifecycle,
      ],
      exports: [
        OUTBOX_OPTIONS,
        OutboxStore,
        RabbitMqOutboxPublisher,
        OutboxRelay,
      ],
    };
  }
}
