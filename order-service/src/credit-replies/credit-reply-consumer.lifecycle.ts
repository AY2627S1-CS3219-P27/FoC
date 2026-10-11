import { AccountEventContractValidator } from '@foc/contracts';
import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { LifecycleService } from '../lifecycle/lifecycle.service.js';
import { RabbitMqConsumerTransport } from '../messaging/rabbitmq-consumer.transport.js';
import { CreditReplyHandler, REPLY_SPECS } from './credit-reply.handler.js';

/** One subscription per reply key (the transport takes one key each). */
@Injectable()
export class CreditReplyConsumerLifecycle implements OnApplicationBootstrap {
  constructor(
    private readonly transport: RabbitMqConsumerTransport,
    private readonly lifecycle: LifecycleService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const contracts = new AccountEventContractValidator();
    for (const spec of REPLY_SPECS) {
      await this.transport.subscribe({
        queue: spec.queue,
        routingKey: spec.key,
        handler: new CreditReplyHandler(spec, this.lifecycle, contracts),
      });
    }
  }
}
