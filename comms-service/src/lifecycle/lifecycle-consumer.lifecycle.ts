import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { RabbitMqConsumerTransport } from '../messaging/rabbitmq-consumer.transport.js';
import { COMMS_LIFECYCLE_STREAMS } from '../messaging/rabbitmq-topology.js';
import { LifecycleMessageDispatcher } from './lifecycle-message.handler.js';

/** Starts all four independent streams only after their durable handler exists. */
@Injectable()
export class LifecycleConsumerLifecycle implements OnApplicationBootstrap {
  constructor(
    private readonly transport: RabbitMqConsumerTransport,
    private readonly handler: LifecycleMessageDispatcher,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.transport.subscribeAll(
      COMMS_LIFECYCLE_STREAMS.map((stream) => ({
        ...stream,
        handler: this.handler,
      })),
    );
  }
}
