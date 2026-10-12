import {
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { OutboxRelay } from './outbox.relay.js';

/** Connects relay startup and graceful drainage to the Nest lifecycle. */
@Injectable()
export class OutboxRelayLifecycle
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  constructor(private readonly relay: OutboxRelay) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.relay.start();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.relay.close();
  }
}
