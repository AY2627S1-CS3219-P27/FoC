import { EventEmitter } from 'node:events';
import type { ConfigService } from '@nestjs/config';
import type { ChannelModel, Options, RecoveryOptions } from 'amqplib';
import type { EnvironmentVariables } from '../config/environment.js';
import type { AmqpConnect } from '../messaging/amqp-connection.provider.js';
import type { OutboxPublication } from './outbox-publication.types.js';
import {
  RabbitMqOutboxConfirmationTimeoutError,
  RabbitMqOutboxPublisher,
} from './rabbitmq-outbox.publisher.js';

class FakeChannel extends EventEmitter {
  readonly exchanges: unknown[][] = [];
  readonly publications: Array<{
    exchange: string;
    routingKey: string;
    content: Buffer;
    options: Options.Publish;
  }> = [];
  automaticConfirmation = true;
  confirmationError?: Error;
  writable = true;
  closed = false;
  drained = false;
  private callback?: (error: Error | null) => void;

  async assertExchange(...args: unknown[]) {
    this.exchanges.push(args);
    return { exchange: String(args[0]) };
  }

  publish(
    exchange: string,
    routingKey: string,
    content: Buffer,
    options: Options.Publish,
    callback: (error: Error | null) => void,
  ) {
    this.publications.push({ exchange, routingKey, content, options });
    this.callback = callback;
    if (this.automaticConfirmation) {
      queueMicrotask(() => callback(this.confirmationError ?? null));
    }
    return this.writable;
  }

  confirm(error: Error | null = null) {
    this.callback?.(error);
  }

  async waitForConfirms() {
    this.drained = true;
  }

  async close() {
    this.closed = true;
  }
}

class FakeModel extends EventEmitter {
  readonly channel = new FakeChannel();
  closed = false;

  async createConfirmChannel() {
    return this.channel;
  }

  async close() {
    this.closed = true;
  }
}

const publication: OutboxPublication = {
  eventId: '19860606-e57b-4e8d-baa9-7f5b11293f41',
  eventType: 'CreditAccountInitialised',
  routingKey: 'credit.account-initialised.v1',
  envelope: {
    eventId: '19860606-e57b-4e8d-baa9-7f5b11293f41',
    eventType: 'CreditAccountInitialised',
  },
};

function harness(timeout = 30_000) {
  const values = {
    RABBITMQ_URL: 'amqp://test',
    RABBITMQ_EXCHANGE: 'foc.events',
    OUTBOX_CLAIM_LEASE_MS: timeout,
  };
  const config = {
    getOrThrow: vi.fn((key: keyof typeof values) => values[key]),
  } as unknown as ConfigService<EnvironmentVariables, true>;
  const model = new FakeModel();
  let recoverySetup: RecoveryOptions['setup'];
  const connect = vi.fn(async (_url, options) => {
    recoverySetup = options.recovery.setup;
    await (recoverySetup as (model: ChannelModel) => Promise<void>)(
      model as unknown as ChannelModel,
    );
    return model;
  }) as unknown as AmqpConnect;
  const publisher = new RabbitMqOutboxPublisher(config, connect);

  return { connect, model, publisher, getRecoverySetup: () => recoverySetup };
}

describe('RabbitMqOutboxPublisher', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('declares the exchange and confirms persistent stored-envelope publication', async () => {
    const { connect, model, publisher } = harness();
    await publisher.start();

    await publisher.publish(publication);

    expect(connect).toHaveBeenCalledWith(
      'amqp://test',
      expect.objectContaining({ recovery: expect.any(Object) }),
    );
    expect(model.channel.exchanges).toEqual([
      ['foc.events', 'topic', { durable: true }],
    ]);
    expect(model.channel.publications).toEqual([
      {
        exchange: 'foc.events',
        routingKey: publication.routingKey,
        content: Buffer.from(JSON.stringify(publication.envelope)),
        options: {
          persistent: true,
          contentType: 'application/json',
          messageId: publication.eventId,
          type: publication.eventType,
          appId: 'credit-service',
        },
      },
    ]);
  });

  it('waits for both publisher confirmation and socket drainage', async () => {
    const { model, publisher } = harness();
    model.channel.automaticConfirmation = false;
    model.channel.writable = false;
    await publisher.start();

    let completed = false;
    const publishing = publisher.publish(publication).then(() => {
      completed = true;
    });
    model.channel.confirm();
    await Promise.resolve();
    expect(completed).toBe(false);

    model.channel.emit('drain');
    await publishing;
    expect(completed).toBe(true);
  });

  it('fails when broker confirmation is missing', async () => {
    vi.useFakeTimers();
    const { model, publisher } = harness(50);
    model.channel.automaticConfirmation = false;
    await publisher.start();

    const publishing = publisher.publish(publication);
    const expectation = expect(publishing).rejects.toBeInstanceOf(
      RabbitMqOutboxConfirmationTimeoutError,
    );
    await vi.advanceTimersByTimeAsync(50);
    await expectation;
  });

  it('rejects a broker nack without treating the event as published', async () => {
    const { model, publisher } = harness();
    model.channel.confirmationError = new Error('broker nack');
    await publisher.start();

    await expect(publisher.publish(publication)).rejects.toThrow('broker nack');
  });

  it('replaces its channel through connection recovery setup', async () => {
    const { getRecoverySetup, publisher } = harness();
    await publisher.start();
    const recovered = new FakeModel();

    await (getRecoverySetup() as (model: ChannelModel) => Promise<void>)(
      recovered as unknown as ChannelModel,
    );
    await publisher.publish(publication);

    expect(recovered.channel.publications).toHaveLength(1);
  });

  it('drains and closes resources idempotently', async () => {
    const { model, publisher } = harness();
    await publisher.start();

    await publisher.close();

    expect(model.channel.drained).toBe(true);
    expect(model.channel.closed).toBe(true);
    expect(model.closed).toBe(true);
    await expect(publisher.close()).resolves.toBeUndefined();
  });
});
