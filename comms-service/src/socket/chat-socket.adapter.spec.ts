import type { IncomingMessage } from 'node:http';
import { createChatSocketServerOptions } from './chat-socket.adapter.js';
import { CHAT_SOCKET_MAX_HTTP_BUFFER_BYTES } from './chat-socket.protocol.js';

describe('chat Socket.IO transport options', () => {
  const allowedOrigin = 'https://foc.example';
  const options = createChatSocketServerOptions(
    '/custom-socket',
    new Set([allowedOrigin]),
  );

  it('forces the configured path and WebSocket-only transport', () => {
    expect(options).toMatchObject({
      path: '/custom-socket',
      transports: ['websocket'],
      allowUpgrades: false,
      serveClient: false,
      perMessageDeflate: false,
      maxHttpBufferSize: CHAT_SOCKET_MAX_HTTP_BUFFER_BYTES,
    });
  });

  it.each([
    [allowedOrigin, true],
    ['https://other.example', false],
    [undefined, false],
  ])('enforces exact origins for upgrade requests', (origin, expected) => {
    const request = { headers: { origin } } as IncomingMessage;
    let accepted: boolean | undefined;
    options.allowRequest!(request, (_error, success) => {
      accepted = success;
    });
    expect(accepted).toBe(expected);
  });
});
