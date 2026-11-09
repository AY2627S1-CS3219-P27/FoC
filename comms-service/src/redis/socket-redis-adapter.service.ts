import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, type RedisClientType } from 'redis';
import type { EnvironmentVariables } from '../config/environment.js';
import { commsMetrics } from '../observability/comms-metrics.js';

export interface SocketRedisClients {
  publisher: RedisClientType;
  subscriber: RedisClientType;
}

/** Dedicated Redis connections used only by the Socket.IO pub/sub adapter. */
@Injectable()
export class SocketRedisAdapterService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(SocketRedisAdapterService.name);
  private readonly clients: SocketRedisClients;
  private readonly adapterClients: SocketRedisClients;
  private connecting?: Promise<void>;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    const options = {
      disableOfflineQueue: true,
      socket: {
        host: config.get('REDIS_HOST', { infer: true }),
        port: config.get('REDIS_PORT', { infer: true }),
      },
      username: config.get('REDIS_USERNAME', { infer: true }),
      database: config.get('REDIS_DB_INDEX', { infer: true }),
    };
    this.clients = {
      publisher: createClient(options),
      subscriber: createClient(options),
    };
    this.adapterClients = {
      publisher: this.safePublisher(this.clients.publisher),
      subscriber: this.clients.subscriber,
    };
    this.observeErrors('publisher', this.clients.publisher);
    this.observeErrors('subscriber', this.clients.subscriber);
  }

  async onModuleInit(): Promise<void> {
    await this.connect();
  }

  async connect(): Promise<void> {
    if (this.clients.publisher.isReady && this.clients.subscriber.isReady) {
      return;
    }
    this.connecting ??= Promise.all([
      this.connectClient(this.clients.publisher),
      this.connectClient(this.clients.subscriber),
    ])
      .then(() => undefined)
      .finally(() => {
        this.connecting = undefined;
      });
    await this.connecting;
  }

  getClients(): SocketRedisClients {
    if (!this.clients.publisher.isReady || !this.clients.subscriber.isReady) {
      throw new Error('Socket adapter Redis connections are not ready');
    }
    return this.adapterClients;
  }

  async check(): Promise<void> {
    const { publisher, subscriber } = this.getClients();
    await Promise.all([publisher.ping(), subscriber.ping()]);
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([
      this.quit(this.clients.publisher),
      this.quit(this.clients.subscriber),
    ]);
  }

  private async connectClient(client: RedisClientType): Promise<void> {
    if (!client.isOpen) await client.connect();
  }

  private async quit(client: RedisClientType): Promise<void> {
    if (client.isOpen) await client.quit();
  }

  private observeErrors(
    role: 'publisher' | 'subscriber',
    client: RedisClientType,
  ): void {
    client.on('error', (error: unknown) => {
      this.reportError(role, 'connection_error', error);
    });
  }

  /** The upstream adapter does not observe publish promises; consume failures. */
  private safePublisher(client: RedisClientType): RedisClientType {
    const publish = client.publish.bind(client);
    return new Proxy(client, {
      get: (target, property) => {
        if (property === 'publish') {
          return (...args: Parameters<RedisClientType['publish']>) =>
            publish(...args).catch((error: unknown) => {
              this.reportError('publisher', 'publish_failed', error);
              return 0;
            });
        }
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }

  private reportError(
    role: 'publisher' | 'subscriber',
    outcome: 'connection_error' | 'publish_failed',
    error: unknown,
  ): void {
    commsMetrics.socketAdapterError(role);
    this.logger.error({
      operation: 'socket_adapter',
      outcome,
      errorClass:
        error instanceof Error ? error.constructor.name : 'UnknownError',
    });
  }
}
