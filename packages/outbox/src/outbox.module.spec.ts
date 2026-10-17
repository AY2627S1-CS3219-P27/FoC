import { OutboxModule } from './outbox.module.js';
import { OUTBOX_OPTIONS, type OutboxOptions } from './outbox.options.js';
import { OutboxRelayLifecycle } from './outbox-relay.lifecycle.js';
import { OutboxRelay } from './outbox.relay.js';
import { OutboxStore } from './outbox.store.js';
import { RabbitMqOutboxPublisher } from './rabbitmq-outbox.publisher.js';

describe('OutboxModule', () => {
  const options: OutboxOptions = {
    exchange: 'foc.events',
    appId: 'test-service',
    rabbitMqUrl: 'amqp://localhost:5672/%2Ffoc',
  };

  it('builds a dynamic module with the outbox providers and exports', () => {
    const dynamic = OutboxModule.forRootAsync({
      useFactory: () => options,
    });

    expect(dynamic.module).toBe(OutboxModule);
    const providedTokens = (dynamic.providers ?? [])
      .map((provider) =>
        'provide' in provider ? provider.provide : provider,
      );
    expect(providedTokens).toEqual(
      expect.arrayContaining([
        OUTBOX_OPTIONS,
        OutboxStore,
        RabbitMqOutboxPublisher,
        OutboxRelay,
        OutboxRelayLifecycle,
      ]),
    );
    expect(dynamic.exports).toEqual(
      expect.arrayContaining([
        OUTBOX_OPTIONS,
        OutboxStore,
        RabbitMqOutboxPublisher,
        OutboxRelay,
      ]),
    );
  });

  it('resolves the configured options through its factory', async () => {
    const dynamic = OutboxModule.forRootAsync({
      useFactory: () => options,
    });

    const optionsProvider = (dynamic.providers ?? []).find(
      (provider) => 'provide' in provider && provider.provide === OUTBOX_OPTIONS,
    );

    expect(optionsProvider).toBeDefined();
    expect(optionsProvider).toHaveProperty('useFactory');
    expect(
      (optionsProvider as { useFactory: () => OutboxOptions }).useFactory(),
    ).toEqual(options);
  });
});
