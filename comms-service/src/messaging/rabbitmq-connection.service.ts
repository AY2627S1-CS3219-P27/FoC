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
  private closePromise?: Promise<void>;
  private readonly beforeClose = new Set<BeforeConnectionClose>();
  private stopping = false;

  constructor(@Inject(RABBITMQ_CONNECTION_URL) private readonly url: string) {}

  async onModuleInit(): Promise<void> {
    await (await this.getConnection()).waitForConnect();
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
    await this.stopRecovery();
  }

  /** Stops reconnect attempts and rejects channel requests waiting on recovery. */
  stopRecovery(): Promise<void> {
    if (!this.closePromise) {
      this.stopping = true;
      const connectionPromise = this.connectionPromise;
      this.connectionPromise = undefined;
      this.closePromise = (async () => {
        const connection = await connectionPromise?.catch(() => undefined);
        // RecoveringChannelModel.close() synchronously stops reconnect timers
        // and rejects channel waiters before awaiting the broker close
        // handshake. Do not let an unresponsive broker make shutdown unbounded.
        if (connection) void connection.close().catch(() => undefined);
      })();
    }
    return this.closePromise;
  }

  private getConnection(): Promise<RecoveringChannelModel> {
    if (this.stopping) {
      return Promise.reject(new Error('RabbitMQ connection is shutting down'));
    }
    if (!this.connectionPromise) {
      let connectionPromise: Promise<RecoveringChannelModel>;
      connectionPromise = connect(this.url, {
        recovery: { waitForConnect: false },
      }).catch((error: unknown) => {
        if (this.connectionPromise === connectionPromise) {
          this.connectionPromise = undefined;
        }
        throw error;
      });
      this.connectionPromise = connectionPromise;
    }

    return this.connectionPromise;
  }
}
