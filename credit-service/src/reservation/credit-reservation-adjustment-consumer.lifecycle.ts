import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/environment.js';
import { RabbitMqConsumerTransport } from '../messaging/rabbitmq-consumer.transport.js';
import { CreditReservationAdjustmentMessageHandler } from './credit-reservation-adjustment-message.handler.js';

@Injectable()
export class CreditReservationAdjustmentConsumerLifecycle implements OnApplicationBootstrap {
  constructor(
    private readonly transport: RabbitMqConsumerTransport,
    private readonly handler: CreditReservationAdjustmentMessageHandler,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.transport.subscribe({
      queue: this.config.getOrThrow(
        'RABBITMQ_CREDIT_RESERVATION_ADJUSTMENT_QUEUE',
      ),
      routingKey: this.config.getOrThrow(
        'RABBITMQ_CREDIT_RESERVATION_ADJUSTMENT_ROUTING_KEY',
      ),
      handler: this.handler,
    });
  }
}
