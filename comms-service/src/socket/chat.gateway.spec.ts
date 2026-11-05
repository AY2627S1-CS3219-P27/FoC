import type { AccessTokenVerifier } from '@foc/auth';
import type { Namespace, Socket } from 'socket.io';
import { ChatCommandError } from '../chats/chat-command.error.js';
import type { MessageCommandService } from '../chats/message-command.service.js';
import type { ReadCommandService } from '../chats/read-command.service.js';
import type { ChatAdmissionService } from './chat-admission.service.js';
import { ChatGateway, roomName } from './chat.gateway.js';
import { ChatSocketError } from './chat-socket.protocol.js';

const userId = '11111111-1111-4111-8111-111111111111';
const chatId = '22222222-2222-4222-8222-222222222222';
const otherChatId = '33333333-3333-4333-8333-333333333333';

type Ack = (response: unknown) => void;
type JoinListener = (payload: unknown, ack?: Ack) => void;

class FakeSocket {
  readonly data: Record<string, unknown> = {};
  readonly listeners = new Map<string, JoinListener>();
  readonly join = vi.fn().mockResolvedValue(undefined);
  readonly emitToRoom = vi.fn();
  readonly to = vi.fn(() => ({ emit: this.emitToRoom }));
  readonly disconnect = vi.fn();
  readonly on = vi.fn((event: string, listener: JoinListener) => {
    this.listeners.set(event, listener);
    return this;
  });

  constructor(readonly cookie?: string) {}

  get handshake(): { headers: { cookie?: string } } {
    return { headers: { cookie: this.cookie } };
  }
}

describe('ChatGateway', () => {
  const verifyWithMetadata = vi.fn();
  const authorize = vi.fn();
  const sendMessage = vi.fn();
  const markRead = vi.fn();
  const namespaceEmit = vi.fn();
  const namespaceTo = vi.fn(() => ({ emit: namespaceEmit }));
  let gateway: ChatGateway;
  let middleware: (socket: Socket, next: (error?: Error) => void) => void;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-04T10:00:00.000Z'));
    vi.clearAllMocks();
    verifyWithMetadata.mockResolvedValue({
      user: { sub: userId },
      expiresAt: new Date('2026-11-04T10:15:00.000Z'),
    });
    authorize.mockResolvedValue({
      chatId,
      state: 'ACTIVE',
      closesAt: null,
      closeReason: null,
      latestSequence: 0,
    });
    gateway = new ChatGateway(
      { verifyWithMetadata } as unknown as AccessTokenVerifier,
      { authorize } as unknown as ChatAdmissionService,
      { send: sendMessage } as unknown as MessageCommandService,
      { markRead } as unknown as ReadCommandService,
    );
    const use = vi.fn();
    gateway.afterInit({ use, to: namespaceTo } as unknown as Namespace);
    middleware = use.mock.calls[0]![0] as typeof middleware;
  });

  afterEach(() => vi.useRealTimers());

  async function authenticate(socket: FakeSocket): Promise<Error | undefined> {
    return new Promise((resolve) => {
      middleware(socket as unknown as Socket, resolve);
    });
  }

  async function join(socket: FakeSocket, payload: unknown): Promise<unknown> {
    gateway.handleConnection(
      socket as unknown as Parameters<ChatGateway['handleConnection']>[0],
    );
    const listener = socket.listeners.get('chat:join')!;
    return new Promise((resolve) => listener(payload, resolve));
  }

  async function send(socket: FakeSocket, payload: unknown): Promise<unknown> {
    gateway.handleConnection(
      socket as unknown as Parameters<ChatGateway['handleConnection']>[0],
    );
    const listener = socket.listeners.get('message:send')!;
    return new Promise((resolve) => listener(payload, resolve));
  }

  async function read(socket: FakeSocket, payload: unknown): Promise<unknown> {
    gateway.handleConnection(
      socket as unknown as Parameters<ChatGateway['handleConnection']>[0],
    );
    const listener = socket.listeners.get('messages:read')!;
    return new Promise((resolve) => listener(payload, resolve));
  }

  it('authenticates only from the access-token cookie and stores no claims', async () => {
    const socket = new FakeSocket('theme=dark; access_token=valid%2Ejwt');

    await expect(authenticate(socket)).resolves.toBeUndefined();

    expect(verifyWithMetadata).toHaveBeenCalledWith('valid.jwt');
    expect(socket.data).toMatchObject({ userId });
    expect(Object.keys(socket.data).sort()).toEqual(['expiryTimer', 'userId']);
  });

  it.each([
    undefined,
    'theme=dark',
    'access_token=',
    'access_token=one; access_token=two',
    'access_token=%E0%A4%A',
  ])('rejects a missing or ambiguous access-token cookie', async (cookie) => {
    const error = await authenticate(new FakeSocket(cookie));

    expect(error).toMatchObject({
      message: 'Authentication required',
      data: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
    });
    expect(verifyWithMetadata).not.toHaveBeenCalled();
  });

  it('sanitizes token verification failures', async () => {
    verifyWithMetadata.mockRejectedValueOnce(new Error('signature details'));

    const error = await authenticate(new FakeSocket('access_token=bad'));

    expect(error).toMatchObject({
      message: 'Authentication required',
      data: { code: 'UNAUTHENTICATED' },
    });
    expect(JSON.stringify(error)).not.toContain('signature details');
  });

  it('disconnects at token expiry and clears connection state', async () => {
    verifyWithMetadata.mockResolvedValueOnce({
      user: { sub: userId },
      expiresAt: new Date('2026-11-04T10:00:01.000Z'),
    });
    const socket = new FakeSocket('access_token=valid');
    await authenticate(socket);

    await vi.advanceTimersByTimeAsync(999);
    expect(socket.disconnect).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(socket.disconnect).toHaveBeenCalledWith(true);

    gateway.handleDisconnect(
      socket as unknown as Parameters<ChatGateway['handleDisconnect']>[0],
    );
    expect(socket.data).toEqual({});
  });

  it('admits a participant to only their deterministic user-scoped room', async () => {
    const socket = new FakeSocket();
    socket.data.userId = userId;

    await expect(join(socket, { chatId })).resolves.toEqual({
      ok: true,
      data: {
        chatId,
        state: 'ACTIVE',
        closesAt: null,
        closeReason: null,
        latestSequence: 0,
      },
    });
    expect(authorize).toHaveBeenCalledWith(userId, chatId);
    expect(socket.join).toHaveBeenCalledWith(roomName(chatId, userId));
    expect(socket.data.admittedChatId).toBe(chatId);
  });

  it('allows an idempotent same-chat join but rejects switching chats', async () => {
    const socket = new FakeSocket();
    socket.data.userId = userId;
    await join(socket, { chatId });

    await expect(join(socket, { chatId })).resolves.toMatchObject({ ok: true });
    await expect(join(socket, { chatId: otherChatId })).resolves.toEqual({
      ok: false,
      error: {
        code: 'CONFLICT',
        message: 'Request conflicts with current socket state',
      },
    });
    expect(authorize).toHaveBeenCalledTimes(2);
  });

  it('prevents concurrent joins from racing into different rooms', async () => {
    let resolveAdmission!: (value: {
      chatId: string;
      state: 'ACTIVE';
      closesAt: null;
      closeReason: null;
      latestSequence: number;
    }) => void;
    authorize.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveAdmission = resolve;
      }),
    );
    const socket = new FakeSocket();
    socket.data.userId = userId;
    gateway.handleConnection(
      socket as unknown as Parameters<ChatGateway['handleConnection']>[0],
    );
    const listener = socket.listeners.get('chat:join')!;
    const first = new Promise((resolve) => listener({ chatId }, resolve));
    const second = new Promise((resolve) =>
      listener({ chatId: otherChatId }, resolve),
    );

    await expect(second).resolves.toMatchObject({
      ok: false,
      error: { code: 'CONFLICT' },
    });
    resolveAdmission({
      chatId,
      state: 'ACTIVE',
      closesAt: null,
      closeReason: null,
      latestSequence: 0,
    });
    await expect(first).resolves.toMatchObject({ ok: true });
    expect(socket.join).toHaveBeenCalledTimes(1);
    expect(socket.join).toHaveBeenCalledWith(roomName(chatId, userId));
  });

  it('rejects invalid payloads and missing acknowledgements before admission', async () => {
    const socket = new FakeSocket();
    socket.data.userId = userId;

    await expect(join(socket, { chatId, extra: true })).resolves.toEqual({
      ok: false,
      error: { code: 'INVALID_REQUEST', message: 'Invalid request' },
    });
    authorize.mockClear();
    gateway.handleConnection(
      socket as unknown as Parameters<ChatGateway['handleConnection']>[0],
    );
    socket.listeners.get('chat:join')!({ chatId });
    await Promise.resolve();
    expect(authorize).not.toHaveBeenCalled();
  });

  it('does not disclose whether a chat is absent or unauthorized', async () => {
    authorize.mockRejectedValueOnce(new ChatSocketError('NOT_FOUND'));
    const socket = new FakeSocket();
    socket.data.userId = userId;

    await expect(join(socket, { chatId })).resolves.toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Chat not found' },
    });
  });

  it('sanitizes unexpected admission failures', async () => {
    authorize.mockRejectedValueOnce(new Error('database host details'));
    const socket = new FakeSocket();
    socket.data.userId = userId;

    await expect(join(socket, { chatId })).resolves.toEqual({
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Unable to complete request',
      },
    });
  });

  it('acknowledges a committed send and emits to the recipient and other sender tabs', async () => {
    const message = {
      messageId: '44444444-4444-4444-8444-444444444444',
      sequence: 1,
      senderUserId: userId,
      content: 'hello',
      timestamp: '2026-11-04T10:00:00.000Z',
      status: 'UNREAD',
    } as const;
    const recipientUserId = '55555555-5555-4555-8555-555555555555';
    sendMessage.mockResolvedValueOnce({
      message,
      recipientUserId,
      inserted: true,
    });
    const socket = new FakeSocket();
    socket.data.userId = userId;
    socket.data.admittedChatId = chatId;
    const payload = {
      chatId,
      clientMessageId: '66666666-6666-4666-8666-666666666666',
      content: 'hello',
    };

    await expect(send(socket, payload)).resolves.toEqual({
      ok: true,
      data: message,
    });
    expect(sendMessage).toHaveBeenCalledWith({
      chatId,
      senderUserId: userId,
      clientMessageId: payload.clientMessageId,
      content: 'hello',
    });
    expect(namespaceTo).toHaveBeenCalledWith(roomName(chatId, recipientUserId));
    expect(namespaceEmit).toHaveBeenCalledWith('message:new', message);
    expect(socket.to).toHaveBeenCalledWith(roomName(chatId, userId));
    expect(socket.emitToRoom).toHaveBeenCalledWith('message:new', message);
  });

  it('returns an idempotent send without emitting it again', async () => {
    sendMessage.mockResolvedValueOnce({
      message: {
        messageId: '44444444-4444-4444-8444-444444444444',
        sequence: 1,
        senderUserId: userId,
        content: 'hello',
        timestamp: '2026-11-04T10:00:00.000Z',
        status: 'READ',
      },
      recipientUserId: '55555555-5555-4555-8555-555555555555',
      inserted: false,
    });
    const socket = new FakeSocket();
    socket.data.userId = userId;
    socket.data.admittedChatId = chatId;

    await expect(
      send(socket, {
        chatId,
        clientMessageId: '66666666-6666-4666-8666-666666666666',
        content: 'hello',
      }),
    ).resolves.toMatchObject({ ok: true, data: { status: 'READ' } });
    expect(namespaceEmit).not.toHaveBeenCalled();
    expect(socket.emitToRoom).not.toHaveBeenCalled();
  });

  it('rejects sends for a different chat before mutation', async () => {
    const socket = new FakeSocket();
    socket.data.userId = userId;
    socket.data.admittedChatId = chatId;

    await expect(
      send(socket, {
        chatId: otherChatId,
        clientMessageId: '66666666-6666-4666-8666-666666666666',
        content: 'hello',
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('maps command conflicts without leaking persistence details', async () => {
    sendMessage.mockRejectedValueOnce(new ChatCommandError('CONFLICT'));
    const socket = new FakeSocket();
    socket.data.userId = userId;
    socket.data.admittedChatId = chatId;

    await expect(
      send(socket, {
        chatId,
        clientMessageId: '66666666-6666-4666-8666-666666666666',
        content: 'hello',
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'CONFLICT',
        message: 'Request conflicts with current socket state',
      },
    });
  });

  it('does not acknowledge or emit until the message command resolves', async () => {
    let resolveSend!: (result: {
      message: {
        messageId: string;
        sequence: number;
        senderUserId: string;
        content: string;
        timestamp: string;
        status: 'UNREAD';
      };
      recipientUserId: string;
      inserted: boolean;
    }) => void;
    sendMessage.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSend = resolve;
      }),
    );
    const socket = new FakeSocket();
    socket.data.userId = userId;
    socket.data.admittedChatId = chatId;
    const pending = send(socket, {
      chatId,
      clientMessageId: '66666666-6666-4666-8666-666666666666',
      content: 'hello',
    });
    const ack = vi.fn();
    void pending.then(ack);

    await Promise.resolve();
    expect(ack).not.toHaveBeenCalled();
    expect(namespaceEmit).not.toHaveBeenCalled();
    resolveSend({
      message: {
        messageId: '44444444-4444-4444-8444-444444444444',
        sequence: 1,
        senderUserId: userId,
        content: 'hello',
        timestamp: '2026-11-04T10:00:00.000Z',
        status: 'UNREAD',
      },
      recipientUserId: '55555555-5555-4555-8555-555555555555',
      inserted: true,
    });
    await expect(pending).resolves.toMatchObject({ ok: true });
    expect(namespaceEmit).toHaveBeenCalledOnce();
  });

  it('acknowledges committed state when one best-effort emission fails', async () => {
    const message = {
      messageId: '44444444-4444-4444-8444-444444444444',
      sequence: 1,
      senderUserId: userId,
      content: 'hello',
      timestamp: '2026-11-04T10:00:00.000Z',
      status: 'UNREAD',
    } as const;
    sendMessage.mockResolvedValueOnce({
      message,
      recipientUserId: '55555555-5555-4555-8555-555555555555',
      inserted: true,
    });
    namespaceTo.mockImplementationOnce(() => {
      throw new Error('adapter unavailable');
    });
    const socket = new FakeSocket();
    socket.data.userId = userId;
    socket.data.admittedChatId = chatId;

    await expect(
      send(socket, {
        chatId,
        clientMessageId: '66666666-6666-4666-8666-666666666666',
        content: 'hello',
      }),
    ).resolves.toEqual({ ok: true, data: message });
    expect(socket.emitToRoom).toHaveBeenCalledWith('message:new', message);
  });

  it('acknowledges a committed read and emits one receipt only to the affected sender', async () => {
    const affectedSenderUserId = '55555555-5555-4555-8555-555555555555';
    const data = {
      chatId,
      throughSequence: 4,
      highestReadSequence: 3,
      readAt: '2026-11-05T01:00:00.000Z',
    };
    markRead.mockResolvedValueOnce({
      data,
      affectedSenderUserId,
      changed: true,
    });
    const socket = new FakeSocket();
    socket.data.userId = userId;
    socket.data.admittedChatId = chatId;

    await expect(read(socket, { chatId, throughSequence: 4 })).resolves.toEqual(
      { ok: true, data },
    );
    expect(markRead).toHaveBeenCalledWith({
      chatId,
      readerUserId: userId,
      throughSequence: 4,
    });
    expect(namespaceTo).toHaveBeenCalledWith(
      roomName(chatId, affectedSenderUserId),
    );
    expect(namespaceEmit).toHaveBeenCalledWith('messages:read-receipt', {
      ...data,
      readerUserId: userId,
    });
    expect(socket.to).not.toHaveBeenCalled();
  });

  it('acknowledges repeated reads without emitting duplicate receipts', async () => {
    const data = {
      chatId,
      throughSequence: 4,
      highestReadSequence: null,
      readAt: null,
    };
    markRead.mockResolvedValueOnce({
      data,
      affectedSenderUserId: '55555555-5555-4555-8555-555555555555',
      changed: false,
    });
    const socket = new FakeSocket();
    socket.data.userId = userId;
    socket.data.admittedChatId = chatId;

    await expect(read(socket, { chatId, throughSequence: 4 })).resolves.toEqual(
      { ok: true, data },
    );
    expect(namespaceEmit).not.toHaveBeenCalled();
  });

  it('rejects reads for a different chat before mutation', async () => {
    const socket = new FakeSocket();
    socket.data.userId = userId;
    socket.data.admittedChatId = chatId;

    await expect(
      read(socket, { chatId: otherChatId, throughSequence: 1 }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    expect(markRead).not.toHaveBeenCalled();
  });

  it('maps read command errors to sanitized acknowledgements', async () => {
    markRead.mockRejectedValueOnce(new ChatCommandError('NOT_FOUND'));
    const socket = new FakeSocket();
    socket.data.userId = userId;
    socket.data.admittedChatId = chatId;

    await expect(read(socket, { chatId, throughSequence: 1 })).resolves.toEqual(
      {
        ok: false,
        error: { code: 'NOT_FOUND', message: 'Chat not found' },
      },
    );
  });

  it('keeps a committed read acknowledgement when receipt emission fails', async () => {
    const data = {
      chatId,
      throughSequence: 1,
      highestReadSequence: 1,
      readAt: '2026-11-05T01:00:00.000Z',
    };
    markRead.mockResolvedValueOnce({
      data,
      affectedSenderUserId: '55555555-5555-4555-8555-555555555555',
      changed: true,
    });
    namespaceTo.mockImplementationOnce(() => {
      throw new Error('adapter unavailable');
    });
    const socket = new FakeSocket();
    socket.data.userId = userId;
    socket.data.admittedChatId = chatId;

    await expect(read(socket, { chatId, throughSequence: 1 })).resolves.toEqual(
      { ok: true, data },
    );
  });
});
