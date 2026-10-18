import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/environment.schema.js';
import { RabbitMqConsumerTransport } from '../messaging/rabbitmq-consumer.transport.js';
import { SupplierValidationMessageHandler } from './supplier-validation-message.handler.js';

/** Starts consuming Order Service's supplier-validation requests at boot. */
@Injectable()
export class SupplierValidationConsumerLifecycle implements OnApplicationBootstrap {
  constructor(
    private readonly transport: RabbitMqConsumerTransport,
    private readonly handler: SupplierValidationMessageHandler,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.transport.subscribe({
      queue: this.config.getOrThrow('RABBITMQ_SUPPLIER_VALIDATION_QUEUE'),
      routingKey: this.config.getOrThrow(
        'RABBITMQ_SUPPLIER_VALIDATION_REQUESTED_ROUTING_KEY',
      ),
      handler: this.handler,
    });
  }
}
