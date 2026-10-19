import { AccountEventContractValidator } from '@foc/contracts';
import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { CreditReplyHandler } from '../credit-replies/credit-reply.handler.js';
import { LifecycleService } from '../lifecycle/lifecycle.service.js';
import { RabbitMqConsumerTransport } from '../messaging/rabbitmq-consumer.transport.js';
import { SUPPLIER_REPLY_SPECS } from './supplier-replies.js';

/** Subscribes the supplier validation reply; same handler as the credit replies. */
@Injectable()
export class SupplierReplyConsumerLifecycle implements OnApplicationBootstrap {
  constructor(
    private readonly transport: RabbitMqConsumerTransport,
    private readonly lifecycle: LifecycleService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const contracts = new AccountEventContractValidator();
    for (const spec of SUPPLIER_REPLY_SPECS) {
      await this.transport.subscribe({
        queue: spec.queue,
        routingKey: spec.key,
        handler: new CreditReplyHandler(spec, this.lifecycle, contracts),
      });
    }
  }
}
