import { connect } from 'amqplib';
import { RabbitMqConnectionService } from './rabbitmq-connection.service.js';

vi.mock('amqplib', () => ({ connect: vi.fn() }));

describe('RabbitMqConnectionService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shares one in-flight connection across startup and channel creation', async () => {
    const channel = { close: vi.fn().mockResolvedValue(undefined) };
    const connection = {
      createChannel: vi.fn().mockResolvedValue(channel),
      close: vi.fn().mockResolvedValue(undefined),
    };
    let resolveConnection!: (value: typeof connection) => void;
    vi.mocked(connect).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveConnection = resolve;
      }) as never,
    );
    const service = new RabbitMqConnectionService('amqp://example');

    const startup = service.onModuleInit();
    const createChannel = service.createChannel();
    expect(connect).toHaveBeenCalledOnce();
    resolveConnection(connection);

    await expect(startup).resolves.toBeUndefined();
    await expect(createChannel).resolves.toBe(channel);
    expect(connection.createChannel).toHaveBeenCalledOnce();
    await service.onApplicationShutdown();
    expect(connection.close).toHaveBeenCalledOnce();
  });

  it('uses a disposable channel for readiness', async () => {
    const channel = { close: vi.fn().mockResolvedValue(undefined) };
    const connection = {
      createChannel: vi.fn().mockResolvedValue(channel),
      close: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(connect).mockResolvedValueOnce(connection as never);
    const service = new RabbitMqConnectionService('amqp://example');

    await service.check();

    expect(connection.createChannel).toHaveBeenCalledOnce();
    expect(channel.close).toHaveBeenCalledOnce();
  });

  it('clears a terminally rejected connection so a later call can retry', async () => {
    const error = new Error('terminal connection failure');
    const channel = { close: vi.fn().mockResolvedValue(undefined) };
    const connection = {
      createChannel: vi.fn().mockResolvedValue(channel),
      close: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(connect)
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(connection as never);
    const service = new RabbitMqConnectionService('amqp://example');

    await expect(service.onModuleInit()).rejects.toBe(error);
    await expect(service.createChannel()).resolves.toBe(channel);

    expect(connect).toHaveBeenCalledTimes(2);
    expect(connection.createChannel).toHaveBeenCalledOnce();
    await service.onApplicationShutdown();
    expect(connection.close).toHaveBeenCalledOnce();
  });
  
  it('creates confirm channels and drains registered users before closing', async () => {
    const confirmChannel = {};
    const connection = {
      createChannel: vi.fn(),
      createConfirmChannel: vi.fn().mockResolvedValue(confirmChannel),
      close: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(connect).mockResolvedValueOnce(connection as never);
    const service = new RabbitMqConnectionService('amqp://example');
    const order: string[] = [];
    service.registerBeforeClose(async () => {
      order.push('transport');
    });
    connection.close.mockImplementation(async () => {
      order.push('connection');
    });

    await expect(service.createConfirmChannel()).resolves.toBe(confirmChannel);
    await service.onApplicationShutdown();

    expect(connection.createConfirmChannel).toHaveBeenCalledOnce();
    expect(order).toEqual(['transport', 'connection']);
  });
});
