import {
  Inject,
  Injectable,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import {
  connect,
  type Channel,
  type ConfirmChannel,
  type RecoveringChannelModel,
} from 'amqplib';
import { RABBITMQ_CONNECTION_URL } from './rabbitmq-connection-url.provider.js';

type BeforeConnectionClose = () => Promise<void>;

@Injectable()
export class RabbitMqConnectionService
  implements OnModuleInit, OnApplicationShutdown
{
  private connectionPromise?: Promise<RecoveringChannelModel>;
  private readonly beforeClose = new Set<BeforeConnectionClose>();

  constructor(@Inject(RABBITMQ_CONNECTION_URL) private readonly url: string) {}

  async onModuleInit(): Promise<void> {
    await this.getConnection();
  }

  async createChannel(): Promise<Channel> {
    return (await this.getConnection()).createChannel();
  }

  async createConfirmChannel(): Promise<ConfirmChannel> {
    return (await this.getConnection()).createConfirmChannel();
  }

  registerBeforeClose(callback: BeforeConnectionClose): () => void {
    this.beforeClose.add(callback);
    return () => this.beforeClose.delete(callback);
  }

  async check(): Promise<void> {
    const channel = await this.createChannel();
    try {
      // Creating a channel is the broker round trip used by readiness.
    } finally {
      await channel.close();
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled(
      [...this.beforeClose].map((callback) => callback()),
    );
    this.beforeClose.clear();
    const connectionPromise = this.connectionPromise;
    this.connectionPromise = undefined;
    const connection = await connectionPromise?.catch(() => undefined);
    await connection?.close();
  }

  private getConnection(): Promise<RecoveringChannelModel> {
    if (!this.connectionPromise) {
      let connectionPromise: Promise<RecoveringChannelModel>;
      connectionPromise = connect(this.url, { recovery: true }).catch(
        (error: unknown) => {
          if (this.connectionPromise === connectionPromise) {
            this.connectionPromise = undefined;
          }
          throw error;
        },
      );
      this.connectionPromise = connectionPromise;
    }

    return this.connectionPromise;
  }
}
