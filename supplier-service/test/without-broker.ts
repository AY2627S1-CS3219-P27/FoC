import { OutboxRelay } from '@foc/outbox';
import type { TestingModuleBuilder } from '@nestjs/testing';
import { RABBITMQ_CONNECTION_URL } from '../src/messaging/rabbitmq-connection-url.provider.js';
import { RabbitMqConsumerTransport } from '../src/messaging/rabbitmq-consumer.transport.js';

/**
 * e2e specs boot AppModule without a broker, as credit-service's do: the
 * consumer, its connection URL and the outbox relay are replaced, so no spec
 * connects to RabbitMQ. Supplier validation itself is covered by the
 * integration and messaging specs.
 */
export function withoutBroker(
  builder: TestingModuleBuilder,
): TestingModuleBuilder {
  return builder
    .overrideProvider(RabbitMqConsumerTransport)
    .useValue({ subscribe: vi.fn(), close: vi.fn() })
    .overrideProvider(RABBITMQ_CONNECTION_URL)
    .useValue('amqp://unused')
    .overrideProvider(OutboxRelay)
    .useValue({ start: vi.fn(), close: vi.fn() });
}
