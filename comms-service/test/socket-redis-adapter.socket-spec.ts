import { createServer, type Server as HttpServer } from 'node:http';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient, type RedisClientType } from 'redis';
import { Server } from 'socket.io';
import { io, type Socket } from 'socket.io-client';

const redisUrl = `redis://${process.env.COMMS_REDIS_TEST_HOST ?? '127.0.0.1'}:${process.env.COMMS_REDIS_TEST_PORT ?? '6381'}`;
const room = 'chat:test:user:recipient';

interface Replica {
  http: HttpServer;
  io: Server;
  publisher: RedisClientType;
  subscriber: RedisClientType;
  url: string;
}

async function replica(): Promise<Replica> {
  const http = createServer();
  const ioServer = new Server(http, { transports: ['websocket'] });
  const publisher = createClient({ url: redisUrl });
  const subscriber = createClient({ url: redisUrl });
  await Promise.all([publisher.connect(), subscriber.connect()]);
  ioServer.adapter(createAdapter(publisher, subscriber));
  ioServer.on('connection', (socket) => void socket.join(room));
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const address = http.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Replica did not bind a TCP port');
  }
  return {
    http,
    io: ioServer,
    publisher,
    subscriber,
    url: `http://127.0.0.1:${address.port}`,
  };
}

async function connect(url: string): Promise<Socket> {
  const socket = io(url, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  return socket;
}

async function closeReplica(replicaToClose: Replica): Promise<void> {
  await new Promise<void>((resolve) =>
    replicaToClose.io.close(() => resolve()),
  );
  await Promise.allSettled([
    replicaToClose.publisher.quit(),
    replicaToClose.subscriber.quit(),
  ]);
}

describe('Socket.IO Redis adapter cross-replica delivery', () => {
  let first: Replica;
  let second: Replica;
  let firstClient: Socket;
  let secondClient: Socket;

  beforeAll(async () => {
    first = await replica();
    second = await replica();
    firstClient = await connect(first.url);
    secondClient = await connect(second.url);
  });

  afterAll(async () => {
    firstClient.disconnect();
    secondClient.disconnect();
    await Promise.all([closeReplica(first), closeReplica(second)]);
  });

  it.each([
    ['message:new', { chatId: 'chat-test', sequence: 4 }],
    ['messages:read-receipt', { chatId: 'chat-test', throughSequence: 4 }],
    [
      'chat:closing',
      {
        chatId: 'chat-test',
        closesAt: '2026-11-06T10:00:00.000Z',
        closeReason: 'ERRAND_DELIVERED',
      },
    ],
    [
      'chat:archived',
      {
        chatId: 'chat-test',
        archiveId: 'archive-test',
        archivedAt: '2026-11-06T10:00:00.000Z',
      },
    ],
  ])(
    'delivers %s from one replica to a client on the other',
    async (event, payload) => {
      const received = new Promise<unknown>((resolve) => {
        secondClient.once(event, resolve);
      });

      first.io.to(room).emit(event, payload);

      await expect(received).resolves.toEqual(payload);
    },
  );
});
