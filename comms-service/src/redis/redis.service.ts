import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, type RedisClientType } from 'redis';
import type { EnvironmentVariables } from '../config/environment.js';

@Injectable()
export class RedisService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: RedisClientType;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    this.client = createClient({
      socket: {
        host: config.get('REDIS_HOST', { infer: true }),
        port: config.get('REDIS_PORT', { infer: true }),
      },
      username: config.get('REDIS_USERNAME', { infer: true }),
      database: config.get('REDIS_DB_INDEX', { infer: true }),
    });
    this.client.on('error', () => this.logger.error('Redis connection error'));
  }

  async onModuleInit(): Promise<void> {
    await this.client.connect();
  }

  async check(): Promise<void> {
    if (!this.client.isReady) throw new Error('Redis connection is not ready');
    await this.client.ping();
  }

  getClient(): RedisClientType {
    return this.client;
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.client.isOpen) await this.client.quit();
  }
}
