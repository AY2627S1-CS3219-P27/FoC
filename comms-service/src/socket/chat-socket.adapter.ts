import type { INestApplicationContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Server, ServerOptions } from 'socket.io';
import type { EnvironmentVariables } from '../config/environment.js';
import { CHAT_SOCKET_MAX_HTTP_BUFFER_BYTES } from './chat-socket.protocol.js';
import { SocketRedisAdapterService } from '../redis/socket-redis-adapter.service.js';

export class ChatSocketIoAdapter extends IoAdapter {
  private readonly path: string;
  private readonly allowedOrigins: ReadonlySet<string>;

  constructor(
    app: INestApplicationContext,
    config: ConfigService<EnvironmentVariables, true>,
    private readonly socketRedis: SocketRedisAdapterService,
  ) {
    super(app);
    this.path = config.get('SOCKET_PATH', { infer: true });
    this.allowedOrigins = new Set(
      config.get('SOCKET_ALLOWED_ORIGINS', { infer: true }),
    );
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const socketOptions = createChatSocketServerOptions(
      this.path,
      this.allowedOrigins,
      options,
    );
    const server = super.createIOServer(port, socketOptions);
    const { publisher, subscriber } = this.socketRedis.getClients();
    server.adapter(createAdapter(publisher, subscriber));
    return server;
  }
}

export function createChatSocketServerOptions(
  path: string,
  allowedOrigins: ReadonlySet<string>,
  base: Partial<ServerOptions> = {},
): ServerOptions {
  const originAllowed = (origin: string | undefined): boolean =>
    origin !== undefined && allowedOrigins.has(origin);

  return {
    ...base,
    path,
    transports: ['websocket'],
    allowUpgrades: false,
    serveClient: false,
    perMessageDeflate: false,
    maxHttpBufferSize: CHAT_SOCKET_MAX_HTTP_BUFFER_BYTES,
    cors: {
      credentials: true,
      origin: (origin, callback) => callback(null, originAllowed(origin)),
    },
    allowRequest: (request, callback) =>
      callback(null, originAllowed(request.headers.origin)),
  } as ServerOptions;
}
