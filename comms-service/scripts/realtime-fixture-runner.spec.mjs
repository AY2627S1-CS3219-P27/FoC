import { EventEmitter } from 'node:events';
import {
  emitAcknowledged,
  readAccessTokenCookie,
  resolveRealtimeFixtureRequest,
  runRealtimeFixture,
} from './realtime-fixture-runner.mjs';

const chatId = '22222222-2222-4222-8222-222222222222';
const senderId = '11111111-1111-4111-8111-111111111111';
const recipientId = '33333333-3333-4333-8333-333333333333';
const messageId = '44444444-4444-4444-8444-444444444444';
const generated = [
  '55555555-5555-4555-8555-555555555555',
  '66666666-6666-4666-8666-666666666666',
  '77777777-7777-4777-8777-777777777777',
];

function request(overrides = {}) {
  return {
    chatId,
    url: 'http://localhost:3001',
    origin: 'http://localhost:3001',
    namespace: '/chat',
    socketPath: '/socket.io',
    timeoutMs: 30,
    disallowedOrigin: 'http://realtime-fixture.invalid',
    senderCookieFile: 'sender.cookie',
    recipientCookieFile: 'recipient.cookie',
    ...overrides,
  };
}

class FakeSocket extends EventEmitter {
  disconnected = false;

  constructor(environment, options) {
    super();
    this.environment = environment;
    this.options = options;
    this.role = options.extraHeaders.Cookie?.replace('access_token=', '');
    queueMicrotask(() => {
      if (options.extraHeaders.Origin !== 'http://localhost:3001') {
        this.emitServer('connect_error', new Error('websocket rejected'));
      } else if (options.transports[0] === 'polling') {
        this.emitServer('connect_error', new Error('transport rejected'));
      } else if (!this.role) {
        const error = new Error('Authentication required');
        error.data = {
          code: 'UNAUTHENTICATED',
          message: 'Authentication required',
        };
        this.emitServer('connect_error', error);
      } else {
        this.emitServer('connect');
      }
    });
  }

  emit(event, payload, acknowledgement) {
    if (event === 'chat:join') {
      const allowed =
        this.role !== 'outsider' && payload.chatId === this.environment.chatId;
      queueMicrotask(() =>
        acknowledgement(
          allowed && this.environment.malformedJoin && this.role === 'sender'
            ? { ok: true }
            : allowed
              ? {
                  ok: true,
                  data: {
                    chatId: payload.chatId,
                    state: 'ACTIVE',
                    closesAt: null,
                    closeReason: null,
                    latestSequence: 0,
                  },
                }
              : {
                  ok: false,
                  error: { code: 'NOT_FOUND', message: 'Chat not found' },
                },
        ),
      );
      return true;
    }
    if (event === 'message:send') {
      const retry = this.environment.message !== undefined;
      this.environment.message ??= {
        messageId,
        sequence: 1,
        senderUserId: senderId,
        content: payload.content,
        timestamp: '2026-11-06T00:00:00.000Z',
        status: 'UNREAD',
      };
      queueMicrotask(() => {
        acknowledgement({ ok: true, data: this.environment.message });
        if (!retry || this.environment.duplicateOnRetry) {
          this.environment
            .socketFor('recipient')
            ?.emitServer('message:new', this.environment.message);
        }
      });
      return true;
    }
    if (event === 'messages:read') {
      const data = {
        chatId: payload.chatId,
        throughSequence: payload.throughSequence,
        highestReadSequence: payload.throughSequence,
        readAt: '2026-11-06T00:00:01.000Z',
      };
      queueMicrotask(() => {
        acknowledgement({ ok: true, data });
        this.environment
          .socketFor('sender')
          ?.emitServer('messages:read-receipt', {
            ...data,
            readerUserId: recipientId,
          });
      });
      return true;
    }
    return super.emit(event, payload, acknowledgement);
  }

  emitServer(event, payload) {
    return super.emit(event, payload);
  }

  disconnect() {
    this.disconnected = true;
    this.removeAllListeners();
    if (this.throwOnDisconnect) throw new Error('disconnect failed');
  }
}

function fakeEnvironment({
  duplicateOnRetry = false,
  outsider = false,
  cleanupFailure = false,
  malformedJoin = false,
} = {}) {
  const environment = {
    chatId,
    duplicateOnRetry,
    malformedJoin,
    message: undefined,
    sockets: [],
    socketFor(role) {
      return [...this.sockets]
        .reverse()
        .find((socket) => socket.role === role && !socket.disconnected);
    },
  };
  const ioFactory = (_url, options) => {
    const socket = new FakeSocket(environment, options);
    if (
      cleanupFailure &&
      socket.role === 'sender' &&
      options.extraHeaders.Origin === 'http://localhost:3001' &&
      options.transports[0] === 'websocket'
    ) {
      socket.throwOnDisconnect = true;
    }
    environment.sockets.push(socket);
    return socket;
  };
  const cookieValues = {
    'sender.cookie': 'access_token=sender',
    'recipient.cookie': 'access_token=recipient',
    'outsider.cookie': 'access_token=outsider',
  };
  const pages = new Map();
  const fetchFn = vi.fn(async (_url, options) => {
    const cookie = options.headers.Cookie;
    const page = pages.get(cookie) ?? 0;
    pages.set(cookie, page + 1);
    return {
      ok: true,
      status: 200,
      json: async () =>
        page === 0
          ? { items: [], hasMore: true, nextCursor: 'next-page' }
          : {
              items: [{ messageId, status: 'READ' }],
              hasMore: false,
              nextCursor: null,
            },
    };
  });
  return {
    environment,
    dependencies: {
      ioFactory,
      fetchFn,
      readCookie: async (path) => cookieValues[path],
      uuid: vi.fn(() => generated.shift() ?? generated.at(-1)),
      timers: {
        setTimeout,
        clearTimeout,
        sleep: (milliseconds) =>
          new Promise((resolvePromise) =>
            setTimeout(resolvePromise, milliseconds),
          ),
      },
      log: vi.fn(),
    },
    request: request(
      outsider ? { outsiderCookieFile: 'outsider.cookie' } : undefined,
    ),
  };
}

describe('realtime fixture request parsing', () => {
  it('resolves required inputs and safe defaults', () => {
    expect(
      resolveRealtimeFixtureRequest(
        [
          '--chat-id',
          chatId,
          '--sender-cookie-file',
          'sender.cookie',
          '--recipient-cookie-file',
          'recipient.cookie',
        ],
        'C:/fixtures',
      ),
    ).toMatchObject({
      chatId,
      url: 'http://localhost:3001',
      origin: 'http://localhost:3001',
      namespace: '/chat',
      socketPath: '/socket.io',
      timeoutMs: 5_000,
      senderCookieFile: expect.stringMatching(/sender\.cookie$/),
    });
  });

  it.each([
    [['--chat-id', chatId], '--sender-cookie-file is required'],
    [
      [
        '--chat-id',
        chatId,
        '--sender-cookie-file',
        'sender.cookie',
        '--recipient-cookie-file',
        'recipient.cookie',
        '--url',
        'http://localhost:3001/path',
      ],
      '--url must be an absolute HTTP origin without a path',
    ],
    [
      [
        '--chat-id',
        chatId,
        '--sender-cookie-file',
        'sender.cookie',
        '--recipient-cookie-file',
        'recipient.cookie',
        '--unknown',
        'value',
      ],
      'Unknown option --unknown',
    ],
  ])('rejects an invalid CLI request', (arguments_, message) => {
    expect(() => resolveRealtimeFixtureRequest(arguments_)).toThrow(message);
  });
});

describe('realtime fixture cookie validation', () => {
  it('accepts only one exact access-token cookie', async () => {
    await expect(
      readAccessTokenCookie('sender.cookie', async () => 'access_token=a.b.c'),
    ).resolves.toBe('access_token=a.b.c');
    await expect(
      readAccessTokenCookie(
        'sender.cookie',
        async () => 'access_token=a.b.c\n',
      ),
    ).rejects.toThrow('without whitespace, attributes, or line breaks');
    await expect(
      readAccessTokenCookie(
        'sender.cookie',
        async () => 'access_token=a.b.c; Path=/',
      ),
    ).rejects.toThrow('without whitespace, attributes, or line breaks');
  });
});

describe('realtime fixture scenario', () => {
  beforeEach(() =>
    generated.splice(
      0,
      generated.length,
      '55555555-5555-4555-8555-555555555555',
      '66666666-6666-4666-8666-666666666666',
      '77777777-7777-4777-8777-777777777777',
    ),
  );

  it('verifies ingress, outsider privacy, commands, receipts, and paged history', async () => {
    const fixture = fakeEnvironment({ outsider: true });

    await expect(
      runRealtimeFixture(fixture.request, fixture.dependencies),
    ).resolves.toBeUndefined();

    expect(fixture.dependencies.fetchFn).toHaveBeenCalledTimes(4);
    expect(
      fixture.environment.sockets.every((socket) => socket.disconnected),
    ).toBe(true);
  });

  it('detects a duplicate retry event and still disconnects every socket', async () => {
    const fixture = fakeEnvironment({ duplicateOnRetry: true });

    await expect(
      runRealtimeFixture(fixture.request, fixture.dependencies),
    ).rejects.toThrow('Idempotent retry emitted a duplicate message');
    expect(
      fixture.environment.sockets.every((socket) => socket.disconnected),
    ).toBe(true);
  });

  it('reports cleanup failure after attempting every socket disconnect', async () => {
    const fixture = fakeEnvironment({ cleanupFailure: true });

    await expect(
      runRealtimeFixture(fixture.request, fixture.dependencies),
    ).rejects.toThrow('One or more sockets failed to disconnect');
    expect(
      fixture.environment.sockets.every((socket) => socket.disconnected),
    ).toBe(true);
  });

  it('rejects a malformed command acknowledgement', async () => {
    const fixture = fakeEnvironment({ malformedJoin: true });

    await expect(
      runRealtimeFixture(fixture.request, fixture.dependencies),
    ).rejects.toThrow(
      'sender join returned a malformed or failed acknowledgement',
    );
    expect(
      fixture.environment.sockets.every((socket) => socket.disconnected),
    ).toBe(true);
  });

  it('times out an unacknowledged command', async () => {
    const socket = { emit: vi.fn() };
    await expect(
      emitAcknowledged(socket, 'chat:join', { chatId }, 5),
    ).rejects.toThrow('chat:join acknowledgement timed out');
  });
});
