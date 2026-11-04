import { Injectable, OnModuleInit } from '@nestjs/common';
import { RabbitMqConnectionService } from './rabbitmq-connection.service.js';
import {
  COMMS_DEAD_LETTER_EXCHANGE,
  COMMS_LIFECYCLE_STREAMS,
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
   * The primary queues and their foc.events bindings are infrastructure-owned.
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

      for (const { queue } of COMMS_LIFECYCLE_STREAMS) {
        // Binding, rather than declaring, verifies that infrastructure created
        // the primary queue without requiring configure access to that queue.
        await channel.bindQueue(queue, COMMS_RETRY_RETURN_EXCHANGE, queue);

        for (const [index, delay] of COMMS_RETRY_DELAYS_MS.entries()) {
          const retryQueue = `${queue}.retry.${index + 1}`;
          await channel.assertQueue(retryQueue, {
            durable: true,
            messageTtl: delay,
            deadLetterExchange: COMMS_RETRY_RETURN_EXCHANGE,
            deadLetterRoutingKey: queue,
          });
          await channel.bindQueue(retryQueue, COMMS_RETRY_EXCHANGE, retryQueue);
        }

        const deadLetterQueue = `${queue}.dlq`;
        await channel.assertQueue(deadLetterQueue, { durable: true });
        await channel.bindQueue(
          deadLetterQueue,
          COMMS_DEAD_LETTER_EXCHANGE,
          deadLetterQueue,
        );
      }
    } finally {
      await channel.close();
    }
  }
}
