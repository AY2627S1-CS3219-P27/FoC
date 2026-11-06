import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACCESS_TOKEN_COOKIE_PATTERN = /^access_token=[^;\s]+$/;
const MAX_HISTORY_PAGES = 100;

export const realtimeFixtureDefaults = Object.freeze({
  url: 'http://localhost:3001',
  namespace: '/chat',
  socketPath: '/socket.io',
  timeoutMs: 5_000,
  disallowedOrigin: 'http://realtime-fixture.invalid',
});

export function resolveRealtimeFixtureRequest(arguments_, cwd = process.cwd()) {
  const values = new Map();
  for (let index = 0; index < arguments_.length; index += 2) {
    const option = arguments_[index];
    const value = arguments_[index + 1];
    if (
      !option?.startsWith('--') ||
      value === undefined ||
      value.startsWith('--')
    ) {
      throw new Error(`Option ${option ?? '<missing>'} requires one value`);
    }
    if (values.has(option))
      throw new Error(`Option ${option} was provided twice`);
    values.set(option, value);
  }

  const allowed = new Set([
    '--chat-id',
    '--sender-cookie-file',
    '--recipient-cookie-file',
    '--outsider-cookie-file',
    '--url',
    '--origin',
    '--socket-path',
    '--timeout-ms',
    '--disallowed-origin',
  ]);
  for (const option of values.keys()) {
    if (!allowed.has(option)) throw new Error(`Unknown option ${option}`);
  }

  const required = [
    '--chat-id',
    '--sender-cookie-file',
    '--recipient-cookie-file',
  ];
  for (const option of required) {
    if (!values.has(option)) throw new Error(`${option} is required`);
  }

  const chatId = values.get('--chat-id');
  if (!UUID_PATTERN.test(chatId)) throw new Error('--chat-id must be a UUID');

  const url = parseHttpOrigin(
    values.get('--url') ?? realtimeFixtureDefaults.url,
    '--url',
  );
  const origin = parseHttpOrigin(values.get('--origin') ?? url, '--origin');
  const disallowedOrigin = parseHttpOrigin(
    values.get('--disallowed-origin') ??
      realtimeFixtureDefaults.disallowedOrigin,
    '--disallowed-origin',
  );
  if (disallowedOrigin === origin) {
    throw new Error('--disallowed-origin must differ from --origin');
  }

  const socketPath =
    values.get('--socket-path') ?? realtimeFixtureDefaults.socketPath;
  if (!/^\/[A-Za-z0-9/_.-]*$/.test(socketPath)) {
    throw new Error('--socket-path must be an absolute transport path');
  }

  const timeoutMs = Number(
    values.get('--timeout-ms') ?? realtimeFixtureDefaults.timeoutMs,
  );
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) {
    throw new Error('--timeout-ms must be an integer from 100 through 60000');
  }

  return {
    chatId,
    url,
    origin,
    namespace: realtimeFixtureDefaults.namespace,
    socketPath,
    timeoutMs,
    disallowedOrigin,
    senderCookieFile: resolve(cwd, values.get('--sender-cookie-file')),
    recipientCookieFile: resolve(cwd, values.get('--recipient-cookie-file')),
    outsiderCookieFile: values.has('--outsider-cookie-file')
      ? resolve(cwd, values.get('--outsider-cookie-file'))
      : undefined,
  };
}

export async function readAccessTokenCookie(path, read = readFile) {
  const value = await read(path, 'utf8');
  if (!ACCESS_TOKEN_COOKIE_PATTERN.test(value)) {
    throw new Error(
      `Cookie file ${path} must contain exactly access_token=<JWT> without whitespace, attributes, or line breaks`,
    );
  }
  return value;
}

export async function runRealtimeFixture(request, dependencies) {
  const {
    ioFactory,
    fetchFn = globalThis.fetch,
    readCookie = readAccessTokenCookie,
    uuid = randomUUID,
    log = () => undefined,
    timers = defaultTimers,
  } = dependencies;
  if (typeof ioFactory !== 'function') throw new Error('ioFactory is required');
  if (typeof fetchFn !== 'function') throw new Error('fetch is unavailable');

  const [senderCookie, recipientCookie, outsiderCookie] = await Promise.all([
    readCookie(request.senderCookieFile),
    readCookie(request.recipientCookieFile),
    request.outsiderCookieFile
      ? readCookie(request.outsiderCookieFile)
      : undefined,
  ]);
  const sockets = [];
  let failure;
  try {
    await expectConnectionRejected(
      createSocket(ioFactory, request, undefined, {
        origin: request.origin,
        transports: ['websocket'],
      }),
      request.timeoutMs,
      timers,
      (error) => error?.data?.code === 'UNAUTHENTICATED',
      'missing-cookie handshake',
    );
    await expectConnectionRejected(
      createSocket(ioFactory, request, senderCookie, {
        origin: request.disallowedOrigin,
        transports: ['websocket'],
      }),
      request.timeoutMs,
      timers,
      () => true,
      'disallowed-origin handshake',
    );
    await expectConnectionRejected(
      createSocket(ioFactory, request, senderCookie, {
        origin: request.origin,
        transports: ['polling'],
      }),
      request.timeoutMs,
      timers,
      () => true,
      'polling handshake',
    );
    log('Ingress rejection checks passed');

    if (outsiderCookie !== undefined) {
      const unknownSocket = createSocket(ioFactory, request, senderCookie);
      const outsiderSocket = createSocket(ioFactory, request, outsiderCookie);
      sockets.push(unknownSocket, outsiderSocket);
      await Promise.all([
        connectSocket(unknownSocket, request.timeoutMs, timers),
        connectSocket(outsiderSocket, request.timeoutMs, timers),
      ]);
      const unknown = await emitAcknowledged(
        unknownSocket,
        'chat:join',
        { chatId: uuid() },
        request.timeoutMs,
        timers,
      );
      const outsider = await emitAcknowledged(
        outsiderSocket,
        'chat:join',
        { chatId: request.chatId },
        request.timeoutMs,
        timers,
      );
      assertFailure(unknown, 'NOT_FOUND', 'unknown chat join');
      assertFailure(outsider, 'NOT_FOUND', 'outsider chat join');
      assert.deepEqual(
        outsider.error,
        unknown.error,
        'Outsider and unknown chat responses differ',
      );
      disconnectSocket(unknownSocket);
      disconnectSocket(outsiderSocket);
      log('Non-disclosing outsider check passed');
    }

    const sender = createSocket(ioFactory, request, senderCookie);
    const recipient = createSocket(ioFactory, request, recipientCookie);
    sockets.push(sender, recipient);
    await Promise.all([
      connectSocket(sender, request.timeoutMs, timers),
      connectSocket(recipient, request.timeoutMs, timers),
    ]);
    const [senderJoin, recipientJoin] = await Promise.all([
      emitAcknowledged(
        sender,
        'chat:join',
        { chatId: request.chatId },
        request.timeoutMs,
        timers,
      ),
      emitAcknowledged(
        recipient,
        'chat:join',
        { chatId: request.chatId },
        request.timeoutMs,
        timers,
      ),
    ]);
    assertSuccess(senderJoin, 'sender join');
    assertSuccess(recipientJoin, 'recipient join');
    assert.equal(senderJoin.data.chatId, request.chatId);
    assert.equal(recipientJoin.data.chatId, request.chatId);
    log('Participant joins passed');

    const clientMessageId = uuid();
    const content = `realtime-fixture-${uuid()}`;
    const [send, delivered] = await Promise.all([
      emitAcknowledged(
        sender,
        'message:send',
        { chatId: request.chatId, clientMessageId, content },
        request.timeoutMs,
        timers,
      ),
      waitForEvent(recipient, 'message:new', request.timeoutMs, timers),
    ]);
    assertSuccess(send, 'message send');
    validateMessage(send.data, request.chatId, content);
    assert.deepEqual(
      delivered,
      send.data,
      'Delivered message differs from acknowledgement',
    );
    log(`Message send passed at sequence ${send.data.sequence}`);

    let duplicate;
    const onDuplicate = () => {
      duplicate = true;
    };
    recipient.on('message:new', onDuplicate);
    const retry = await emitAcknowledged(
      sender,
      'message:send',
      { chatId: request.chatId, clientMessageId, content },
      request.timeoutMs,
      timers,
    );
    assertSuccess(retry, 'idempotent message retry');
    assert.deepEqual(
      retry.data,
      send.data,
      'Idempotent retry returned a different message',
    );
    await timers.sleep(Math.min(500, request.timeoutMs));
    recipient.off('message:new', onDuplicate);
    assert.notEqual(
      duplicate,
      true,
      'Idempotent retry emitted a duplicate message',
    );
    log('Idempotent retry passed');

    const [read, receipt] = await Promise.all([
      emitAcknowledged(
        recipient,
        'messages:read',
        { chatId: request.chatId, throughSequence: send.data.sequence },
        request.timeoutMs,
        timers,
      ),
      waitForEvent(sender, 'messages:read-receipt', request.timeoutMs, timers),
    ]);
    assertSuccess(read, 'messages read');
    validateReadData(read.data, request.chatId, send.data.sequence);
    validateReadData(receipt, request.chatId, send.data.sequence);
    assert.equal(
      UUID_PATTERN.test(receipt.readerUserId),
      true,
      'Receipt has an invalid readerUserId',
    );
    assert.deepEqual(
      {
        chatId: receipt.chatId,
        throughSequence: receipt.throughSequence,
        highestReadSequence: receipt.highestReadSequence,
        readAt: receipt.readAt,
      },
      read.data,
      'Receipt differs from read acknowledgement',
    );
    log(`Read receipt passed through sequence ${send.data.sequence}`);

    await Promise.all([
      assertHistoryRead(request, senderCookie, send.data.messageId, fetchFn),
      assertHistoryRead(request, recipientCookie, send.data.messageId, fetchFn),
    ]);
    log('HTTP history reconciliation passed');
  } catch (error) {
    failure = error;
  } finally {
    try {
      disconnectSockets(sockets);
    } catch (cleanupError) {
      failure = failure
        ? new AggregateError(
            [failure, cleanupError],
            'Fixture and cleanup failed',
          )
        : cleanupError;
    }
  }
  if (failure) throw failure;
}

export function emitAcknowledged(
  socket,
  event,
  payload,
  timeoutMs,
  timers = defaultTimers,
) {
  return new Promise((resolvePromise, rejectPromise) => {
    const timeout = timers.setTimeout(
      () => rejectPromise(new Error(`${event} acknowledgement timed out`)),
      timeoutMs,
    );
    socket.emit(event, payload, (response) => {
      timers.clearTimeout(timeout);
      resolvePromise(response);
    });
  });
}

function createSocket(ioFactory, request, cookie, overrides = {}) {
  const origin = overrides.origin ?? request.origin;
  const headers = { Origin: origin };
  if (cookie !== undefined) headers.Cookie = cookie;
  return ioFactory(`${request.url}${request.namespace}`, {
    path: request.socketPath,
    transports: overrides.transports ?? ['websocket'],
    forceNew: true,
    reconnection: false,
    timeout: request.timeoutMs,
    extraHeaders: headers,
  });
}

function connectSocket(socket, timeoutMs, timers) {
  return new Promise((resolvePromise, rejectPromise) => {
    const timeout = timers.setTimeout(() => {
      cleanup();
      rejectPromise(new Error('Socket connection timed out'));
    }, timeoutMs);
    const onConnect = () => {
      cleanup();
      resolvePromise();
    };
    const onError = (error) => {
      cleanup();
      rejectPromise(
        new Error(`Socket connection failed: ${safeMessage(error)}`),
      );
    };
    const cleanup = () => {
      timers.clearTimeout(timeout);
      socket.off('connect', onConnect);
      socket.off('connect_error', onError);
    };
    socket.on('connect', onConnect);
    socket.on('connect_error', onError);
  });
}

async function expectConnectionRejected(
  socket,
  timeoutMs,
  timers,
  predicate,
  label,
) {
  try {
    const error = await new Promise((resolvePromise, rejectPromise) => {
      const timeout = timers.setTimeout(
        () => rejectPromise(new Error(`${label} timed out`)),
        timeoutMs,
      );
      socket.once('connect', () => {
        timers.clearTimeout(timeout);
        rejectPromise(new Error(`${label} unexpectedly connected`));
      });
      socket.once('connect_error', (connectionError) => {
        timers.clearTimeout(timeout);
        resolvePromise(connectionError);
      });
    });
    assert.equal(
      predicate(error),
      true,
      `${label} returned an unexpected error`,
    );
  } finally {
    disconnectSocket(socket);
  }
}

function waitForEvent(socket, event, timeoutMs, timers) {
  return new Promise((resolvePromise, rejectPromise) => {
    const timeout = timers.setTimeout(() => {
      socket.off(event, onEvent);
      rejectPromise(new Error(`${event} timed out`));
    }, timeoutMs);
    const onEvent = (payload) => {
      timers.clearTimeout(timeout);
      socket.off(event, onEvent);
      resolvePromise(payload);
    };
    socket.on(event, onEvent);
  });
}

async function assertHistoryRead(request, cookie, messageId, fetchFn) {
  let cursor;
  for (let page = 0; page < MAX_HISTORY_PAGES; page += 1) {
    const query = new URLSearchParams({ limit: '50' });
    if (cursor) query.set('cursor', cursor);
    const response = await fetchFn(
      `${request.url}/api/chats/${request.chatId}/messages?${query}`,
      { headers: { Cookie: cookie, Origin: request.origin } },
    );
    if (!response.ok)
      throw new Error(`History request failed with HTTP ${response.status}`);
    const body = await response.json();
    if (!body || !Array.isArray(body.items))
      throw new Error('History response is malformed');
    const message = body.items.find((item) => item?.messageId === messageId);
    if (message) {
      assert.equal(
        message.status,
        'READ',
        'Committed message is not READ in history',
      );
      return;
    }
    if (body.hasMore !== true) break;
    if (typeof body.nextCursor !== 'string' || body.nextCursor.length === 0) {
      throw new Error('History response omitted its continuation cursor');
    }
    cursor = body.nextCursor;
  }
  throw new Error('Committed message was not found in HTTP history');
}

function assertSuccess(response, operation) {
  if (
    !response ||
    response.ok !== true ||
    typeof response.data !== 'object' ||
    response.data === null
  ) {
    throw new Error(
      `${operation} returned a malformed or failed acknowledgement`,
    );
  }
}

function assertFailure(response, code, operation) {
  if (
    !response ||
    response.ok !== false ||
    response.error?.code !== code ||
    typeof response.error?.message !== 'string'
  ) {
    throw new Error(`${operation} did not return ${code}`);
  }
}

function validateMessage(message, chatId, content) {
  assert.equal(
    UUID_PATTERN.test(message.messageId),
    true,
    'Message ID is invalid',
  );
  assert.equal(
    Number.isSafeInteger(message.sequence) && message.sequence > 0,
    true,
    'Message sequence is invalid',
  );
  assert.equal(
    UUID_PATTERN.test(message.senderUserId),
    true,
    'Sender ID is invalid',
  );
  assert.equal(
    message.content,
    content,
    'Committed content differs from the request',
  );
  assert.equal(
    Number.isNaN(Date.parse(message.timestamp)),
    false,
    'Message timestamp is invalid',
  );
  assert.equal(
    message.status,
    'UNREAD',
    `New message in ${chatId} is not UNREAD`,
  );
}

function validateReadData(data, chatId, sequence) {
  assert.equal(data?.chatId, chatId, 'Read result has the wrong chat');
  assert.equal(
    data?.throughSequence,
    sequence,
    'Read result has the wrong throughSequence',
  );
  assert.equal(
    data?.highestReadSequence,
    sequence,
    'Read result has the wrong highestReadSequence',
  );
  assert.equal(
    Number.isNaN(Date.parse(data?.readAt)),
    false,
    'Read timestamp is invalid',
  );
}

function disconnectSocket(socket) {
  socket.disconnect();
}

function disconnectSockets(sockets) {
  const failures = [];
  for (const socket of sockets) {
    try {
      disconnectSocket(socket);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      'One or more sockets failed to disconnect',
    );
  }
}

function parseHttpOrigin(value, option) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${option} must be an absolute HTTP origin`);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== value) {
    throw new Error(`${option} must be an absolute HTTP origin without a path`);
  }
  return url.origin;
}

function safeMessage(error) {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : 'connection rejected';
}

const defaultTimers = {
  setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
  clearTimeout: (timeout) => clearTimeout(timeout),
  sleep: (milliseconds) =>
    new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)),
};
