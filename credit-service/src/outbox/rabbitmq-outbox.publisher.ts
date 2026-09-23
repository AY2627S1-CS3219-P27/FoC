import { once } from 'node:events';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  ChannelModel,
  ConfirmChannel,
  RecoveringChannelModel,
} from 'amqplib';
import type { EnvironmentVariables } from '../config/environment.js';
import {
  AMQP_CONNECT,
  type AmqpConnect,
} from '../messaging/amqp-connection.provider.js';
import type { OutboxPublication } from './outbox-publication.types.js';

export class RabbitMqOutboxPublisherUnavailableError extends Error {
  constructor() {
    super('RabbitMQ outbox publisher is not connected');
    this.name = 'RabbitMqOutboxPublisherUnavailableError';
  }
}

export class RabbitMqOutboxConfirmationTimeoutError extends Error {
  constructor() {
    super('RabbitMQ did not confirm outbox publication before the claim lease');
    this.name = 'RabbitMqOutboxConfirmationTimeoutError';
  }
}

/** Publishes durable outbox messages through a dedicated confirm channel. */
@Injectable()
export class RabbitMqOutboxPublisher {
  private readonly logger = new Logger(RabbitMqOutboxPublisher.name);
  private readonly exchange: string;
  private readonly confirmationTimeoutMilliseconds: number;
  private readonly rabbitMqUrl: string;
  private connection?: RecoveringChannelModel;
  private channel?: ConfirmChannel;
  private started = false;
  private stopping = false;

  constructor(
    config: ConfigService<EnvironmentVariables, true>,
    @Inject(AMQP_CONNECT) private readonly connectAmqp: AmqpConnect,
  ) {
    this.exchange = config.getOrThrow('RABBITMQ_EXCHANGE');
    this.confirmationTimeoutMilliseconds = config.getOrThrow(
      'OUTBOX_CLAIM_LEASE_MS',
    );
    this.rabbitMqUrl = config.getOrThrow('RABBITMQ_URL');
  }

  async start(): Promise<void> {
    if (this.started) {
      throw new Error('RabbitMQ outbox publisher has already been started');
    }

    this.started = true;
    this.stopping = false;
    try {
      this.connection = await this.connectAmqp(this.rabbitMqUrl, {
        recovery: {
          initialDelay: 100,
          maxDelay: 30_000,
          factor: 2,
          jitter: 0.2,
          maxRetries: Number.POSITIVE_INFINITY,
          setup: async (model: ChannelModel) => this.setupConnection(model),
        },
      });
      this.registerConnectionLogging(this.connection);
    } catch (error) {
      this.started = false;
      throw error;
    }
  }

  async publish(event: OutboxPublication): Promise<void> {
    const channel = this.channel;
    if (!channel || this.stopping) {
      throw new RabbitMqOutboxPublisherUnavailableError();
    }

    const content = Buffer.from(JSON.stringify(event.envelope));
    let resolveConfirmation!: () => void;
    let rejectConfirmation!: (error: unknown) => void;
    const confirmation = new Promise<void>((resolve, reject) => {
      resolveConfirmation = resolve;
      rejectConfirmation = reject;
    });

    let writable = true;
    try {
      writable = channel.publish(
        this.exchange,
        event.routingKey,
        content,
        {
          persistent: true,
          contentType: 'application/json',
          messageId: event.eventId,
          type: event.eventType,
          appId: 'credit-service',
        },
        (error) => {
          if (error) {
            rejectConfirmation(error);
          } else {
            resolveConfirmation();
          }
        },
      );
    } catch (error) {
      rejectConfirmation(error);
    }

    const drained = writable ? Promise.resolve() : once(channel, 'drain');
    await this.withConfirmationTimeout(Promise.all([confirmation, drained]));
  }

  async close(): Promise<void> {
    if (this.stopping || !this.started) {
      return;
    }

    this.stopping = true;
    await this.channel?.waitForConfirms().catch((error) => {
      this.logger.warn(
        `Unable to drain outbox confirmations: ${this.errorName(error)}`,
      );
    });
    await this.channel?.close().catch((error) => {
      this.logger.warn(
        `Unable to close outbox publisher channel: ${this.errorName(error)}`,
      );
    });
    await this.connection?.close().catch((error) => {
      this.logger.warn(
        `Unable to close outbox publisher connection: ${this.errorName(error)}`,
      );
    });
    this.channel = undefined;
    this.connection = undefined;
  }

  private async setupConnection(model: ChannelModel): Promise<void> {
    if (this.stopping) {
      return;
    }

    const channel = await model.createConfirmChannel();
    await channel.assertExchange(this.exchange, 'topic', { durable: true });
    channel.on('error', (error) =>
      this.logger.error(
        `RabbitMQ outbox channel error: ${this.errorName(error)}`,
      ),
    );
    channel.on('close', () => {
      if (!this.stopping) {
        this.channel = undefined;
        this.logger.warn('RabbitMQ outbox channel closed unexpectedly');
        void model.close().catch(() => undefined);
      }
    });
    this.channel = channel;
  }

  private async withConfirmationTimeout<T>(operation: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new RabbitMqOutboxConfirmationTimeoutError()),
        this.confirmationTimeoutMilliseconds,
      );
    });

    try {
      return await Promise.race([operation, timeout]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  private registerConnectionLogging(connection: RecoveringChannelModel): void {
    connection.on('connect', () =>
      this.logger.log('RabbitMQ outbox publisher connected'),
    );
    connection.on('disconnect', (error) =>
      this.logger.warn(
        `RabbitMQ outbox publisher disconnected: ${this.errorName(error)}`,
      ),
    );
    connection.on('reconnect-scheduled', ({ attempt, delay }) =>
      this.logger.warn(
        `RabbitMQ outbox reconnect ${attempt} scheduled in ${delay}ms`,
      ),
    );
    connection.on('error', (error) =>
      this.logger.error(
        `RabbitMQ outbox connection error: ${this.errorName(error)}`,
      ),
    );
  }

  private errorName(error: unknown): string {
    return error instanceof Error ? error.name : 'Error';
  }
}
