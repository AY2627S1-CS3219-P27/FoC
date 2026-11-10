import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AccountEventContractValidator,
  DomainEventDispatcher,
} from '@foc/contracts';
import {
  connect,
  type Channel,
  type ChannelModel,
  type ConfirmChannel,
  type RecoveringChannelModel,
} from 'amqplib';
import { createDispatchHandlers } from '../dispatch/dispatch-handlers.js';
import { DispatchService } from '../dispatch/dispatch.service.js';
import { InboxService } from '../inbox/inbox.service.js';
import {
  createInboxEventHandler,
  type InboxMessageHandler,
} from './inbox-event-handler.js';
import {
  declareInboxTopology,
  NOTIFICATION_QUEUE,
} from './notification-topology.js';
import { RABBITMQ_CONNECTION_URL } from './rabbitmq-connection-url.provider.js';

interface ConsumerState {
  consumerChannel: Channel;
  publisherChannel: ConfirmChannel;
  consumerTag: string;
  model: ChannelModel;
}

/**
 * Owns the RabbitMQ connection lifecycle for the notification inbox.
 *
 * The primary queue and its `order.#` binding are root infrastructure. This service
 * owns the retry chain on the shared headers exchange, the return binding that
 * replays retries onto its own queue, and its dead-letter queue. Message
 * handling lives in `inbox-event-handler.ts`; this class only installs the
 * consumer, recovers connections, and shuts down cleanly.
 */
@Injectable()
export class InboxConsumer implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(InboxConsumer.name);
  private readonly retryDelays: number[];
  private readonly prefetch: number;
  private readonly handleEvent: InboxMessageHandler;
  private state?: ConsumerState;
  private model?: RecoveringChannelModel;
  private activeModel?: ChannelModel;
  private stopping = false;
  private recycling = false;
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    @Inject(RABBITMQ_CONNECTION_URL) private readonly url: string,
    config: ConfigService,
    contracts: AccountEventContractValidator,
    dispatcher: DomainEventDispatcher,
    inbox: InboxService,
    dispatch: DispatchService,
  ) {
    this.retryDelays = config.getOrThrow<number[]>('RABBITMQ_RETRY_DELAYS_MS');
    this.prefetch = config.getOrThrow<number>('RABBITMQ_PREFETCH');
    this.handleEvent = createInboxEventHandler({
      contracts,
      dispatcher,
      inbox,
      dispatch,
      handlers: createDispatchHandlers(dispatch),
      retryDelays: this.retryDelays,
      logger: this.logger,
    });
  }

  async onModuleInit(): Promise<void> {
    await this.connect();
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    await this.state?.consumerChannel
      .cancel(this.state.consumerTag)
      .catch(() => undefined);
    await Promise.allSettled(this.inFlight);
    await this.state?.consumerChannel.close().catch(() => undefined);
    await this.state?.publisherChannel.close().catch(() => undefined);
    await this.model?.close().catch(() => undefined);
    this.state = undefined;
  }

  private async connect(): Promise<void> {
    this.model = await connect(this.url, {
      recovery: {
        initialDelay: 100,
        maxDelay: 30_000,
        factor: 2,
        jitter: 0.2,
        maxRetries: Number.POSITIVE_INFINITY,
        setup: async (model: ChannelModel) => this.setup(model),
      },
    });
    const model = this.model;
    model.on('connect', () => this.logger.log('RabbitMQ connected'));
    model.on('disconnect', (error) =>
      this.logger.warn(`RabbitMQ disconnected: ${error.message}`),
    );
    model.on('reconnect-scheduled', ({ attempt, delay }) =>
      this.logger.warn(`RabbitMQ reconnect ${attempt} scheduled in ${delay}ms`),
    );
    model.on('blocked', (reason) =>
      this.logger.warn(`RabbitMQ connection blocked: ${reason}`),
    );
    model.on('unblocked', () => this.logger.log('RabbitMQ unblocked'));
    model.on('error', (error) =>
      this.logger.error(`RabbitMQ connection error: ${error.message}`),
    );
  }

  /** Re-runs on every reconnect so topology and consumers are rebuilt. */
  private async setup(model: ChannelModel): Promise<void> {
    if (this.stopping) {
      return;
    }

    this.recycling = false;
    this.activeModel = model;
    this.state = undefined;

    const consumerChannel = await model.createChannel();
    const publisherChannel = await model.createConfirmChannel();
    consumerChannel.on('error', (error) =>
      this.logger.error(`RabbitMQ consumer channel error: ${error.message}`),
    );
    publisherChannel.on('error', (error) =>
      this.logger.error(`RabbitMQ publisher channel error: ${error.message}`),
    );
    consumerChannel.on('close', () => {
      if (!this.stopping) {
        this.logger.warn('RabbitMQ consumer channel closed; reconnecting');
        void this.recycle(model);
      }
    });

    try {
      await declareInboxTopology(consumerChannel, this.retryDelays);
      await consumerChannel.prefetch(this.prefetch);
      const reply = await consumerChannel.consume(
        NOTIFICATION_QUEUE,
        (message) => {
          if (message === null) {
            void this.recycle(model);
            return;
          }
          const processing = this.handleEvent(
            message,
            consumerChannel,
            publisherChannel,
          ).catch((error) => {
            this.logger.error(
              `Notification delivery finalization failed: ${String(error)}`,
            );
          });
          this.inFlight.add(processing);
          void processing.finally(() => this.inFlight.delete(processing));
        },
        { noAck: false },
      );

      this.state = {
        consumerChannel,
        publisherChannel,
        consumerTag: reply.consumerTag,
        model,
      };
    } catch (error) {
      await consumerChannel.close().catch(() => undefined);
      await publisherChannel.close().catch(() => undefined);
      throw error;
    }
  }

  private async recycle(model: ChannelModel): Promise<void> {
    if (this.stopping || this.recycling || this.activeModel !== model) {
      return;
    }
    this.recycling = true;
    this.activeModel = undefined;
    await model.close().catch(() => undefined);
  }
}
