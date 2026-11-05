import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { RabbitMqConsumerTransport } from '../messaging/rabbitmq-consumer.transport.js';
import { COMMS_EVENTS_QUEUE } from '../messaging/rabbitmq-topology.js';
import { LifecycleMessageDispatcher } from './lifecycle-message.handler.js';

/** Starts the unified Order event stream after its durable handler exists. */
@Injectable()
export class LifecycleConsumerLifecycle implements OnApplicationBootstrap {
  constructor(
    private readonly transport: RabbitMqConsumerTransport,
    private readonly handler: LifecycleMessageDispatcher,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.transport.subscribe({
      queue: COMMS_EVENTS_QUEUE,
      handler: this.handler,
    });
  }
}
