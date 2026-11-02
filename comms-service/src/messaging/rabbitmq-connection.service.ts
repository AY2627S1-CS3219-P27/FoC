import {
  Inject,
  Injectable,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { connect, type RecoveringChannelModel } from 'amqplib';
import { RABBITMQ_CONNECTION_URL } from './rabbitmq-connection-url.provider.js';

@Injectable()
export class RabbitMqConnectionService
  implements OnModuleInit, OnApplicationShutdown
{
  private connection?: RecoveringChannelModel;

  constructor(@Inject(RABBITMQ_CONNECTION_URL) private readonly url: string) {}

  async onModuleInit(): Promise<void> {
    this.connection = await connect(this.url, { recovery: true });
  }

  async check(): Promise<void> {
    if (!this.connection)
      throw new Error('RabbitMQ connection is not initialized');
    const channel = await this.connection.createChannel();
    await channel.close();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.connection?.close();
  }
}
