import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/environment.schema.js';
import type { RabbitMqConsumerTransport } from '../messaging/rabbitmq-consumer.transport.js';
import { SupplierValidationConsumerLifecycle } from './supplier-validation-consumer.lifecycle.js';
import type { SupplierValidationMessageHandler } from './supplier-validation-message.handler.js';

describe('SupplierValidationConsumerLifecycle', () => {
  it('subscribes the handler to the configured queue and routing key at boot', async () => {
    const subscribe = vi.fn().mockResolvedValue(undefined);
    const handler = {} as SupplierValidationMessageHandler;
    const values: Record<string, string> = {
      RABBITMQ_SUPPLIER_VALIDATION_QUEUE:
        'supplier-service.order-supplier-validation-requested.v1',
      RABBITMQ_SUPPLIER_VALIDATION_REQUESTED_ROUTING_KEY:
        'order.supplier-validation-requested.v1',
    };
    const lifecycle = new SupplierValidationConsumerLifecycle(
      { subscribe } as unknown as RabbitMqConsumerTransport,
      handler,
      {
        getOrThrow: (key: string) => values[key],
      } as unknown as ConfigService<EnvironmentVariables, true>,
    );

    await lifecycle.onApplicationBootstrap();

    expect(subscribe).toHaveBeenCalledWith({
      queue: 'supplier-service.order-supplier-validation-requested.v1',
      routingKey: 'order.supplier-validation-requested.v1',
      handler,
    });
  });
});
