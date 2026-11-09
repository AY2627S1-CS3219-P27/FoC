import { Injectable, OnModuleInit } from '@nestjs/common';
import { RabbitMqConnectionService } from './rabbitmq-connection.service.js';
import {
  COMMS_DEAD_LETTER_EXCHANGE,
  COMMS_EVENTS_BINDING_KEY,
  COMMS_EVENTS_QUEUE,
  COMMS_PUBSUB_EXCHANGE,
  COMMS_RETRY_DELAYS_MS,
  COMMS_RETRY_EXCHANGE,
  COMMS_RETRY_RETURN_EXCHANGE,
} from './rabbitmq-topology.js';

@Injectable()
export class RabbitMqTopologyService implements OnModuleInit {
  constructor(private readonly connection: RabbitMqConnectionService) {}

  async onModuleInit(): Promise<void> {
    await this.provision();
  }

  /**
   * Idempotently declares only Communication Service-owned resources.
   * Infrastructure owns foc.pubsub; this service owns its queue and binding.
   */
  async provision(): Promise<void> {
    const channel = await this.connection.createChannel();
    try {
      await channel.assertExchange(COMMS_RETRY_EXCHANGE, 'direct', {
        durable: true,
      });
      await channel.assertExchange(COMMS_RETRY_RETURN_EXCHANGE, 'direct', {
        durable: true,
      });
      await channel.assertExchange(COMMS_DEAD_LETTER_EXCHANGE, 'direct', {
        durable: true,
      });

      await channel.assertQueue(COMMS_EVENTS_QUEUE, { durable: true });
      await channel.bindQueue(
        COMMS_EVENTS_QUEUE,
        COMMS_PUBSUB_EXCHANGE,
        COMMS_EVENTS_BINDING_KEY,
      );
      await channel.bindQueue(
        COMMS_EVENTS_QUEUE,
        COMMS_RETRY_RETURN_EXCHANGE,
        COMMS_EVENTS_QUEUE,
      );

      for (const [index, delay] of COMMS_RETRY_DELAYS_MS.entries()) {
        const retryQueue = `${COMMS_EVENTS_QUEUE}.retry.${index + 1}`;
        await channel.assertQueue(retryQueue, {
          durable: true,
          messageTtl: delay,
          deadLetterExchange: COMMS_RETRY_RETURN_EXCHANGE,
          deadLetterRoutingKey: COMMS_EVENTS_QUEUE,
        });
        await channel.bindQueue(retryQueue, COMMS_RETRY_EXCHANGE, retryQueue);
      }

      const deadLetterQueue = `${COMMS_EVENTS_QUEUE}.dlq`;
      await channel.assertQueue(deadLetterQueue, { durable: true });
      await channel.bindQueue(
        deadLetterQueue,
        COMMS_DEAD_LETTER_EXCHANGE,
        deadLetterQueue,
      );
    } finally {
      await channel.close();
    }
  }
}
