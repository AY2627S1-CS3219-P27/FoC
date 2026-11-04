import { Logger } from '@nestjs/common';
import { AccessTokenVerifier } from '@foc/auth';
import { ACCESS_TOKEN_COOKIE } from '@foc/contracts';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import { ChatCommandError } from '../chats/chat-command.error.js';
import { MessageCommandService } from '../chats/message-command.service.js';
import type { CommittedMessageDto } from '../chats/message-command.types.js';
import { ChatAdmissionService } from './chat-admission.service.js';
import {
  CHAT_NAMESPACE,
  ChatSocketError,
  chatSocketFailure,
  parseChatJoinPayload,
  parseMessageSendPayload,
  type ChatJoinData,
  type ChatSocketAcknowledgement,
  type MessageSendData,
} from './chat-socket.protocol.js';

const MAX_TIMEOUT_MS = 2_147_483_647;

interface ChatSocketData {
  userId?: string;
  admittedChatId?: string;
  joinInFlight?: Promise<ChatJoinData>;
  expiryTimer?: ReturnType<typeof setTimeout>;
}

type ChatJoinAck = (response: ChatSocketAcknowledgement<ChatJoinData>) => void;
type MessageSendAck = (
  response: ChatSocketAcknowledgement<MessageSendData>,
) => void;

interface ChatClientEvents {
  'chat:join': (payload: unknown, ack?: ChatJoinAck) => void;
  'message:send': (payload: unknown, ack?: MessageSendAck) => void;
}

interface ChatServerEvents {
  'message:new': (message: CommittedMessageDto) => void;
}

type ChatSocket = Socket<
  ChatClientEvents,
  ChatServerEvents,
  Record<string, never>,
  ChatSocketData
>;

@WebSocketGateway({ namespace: CHAT_NAMESPACE })
export class ChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(ChatGateway.name);
  private namespace?: Namespace<
    ChatClientEvents,
    ChatServerEvents,
    Record<string, never>,
    ChatSocketData
  >;

  constructor(
    private readonly tokens: AccessTokenVerifier,
    private readonly admissions: ChatAdmissionService,
    private readonly messages: MessageCommandService,
  ) {}

  afterInit(namespace: Namespace): void {
    this.namespace = namespace as Namespace<
      ChatClientEvents,
      ChatServerEvents,
      Record<string, never>,
      ChatSocketData
    >;
    this.namespace!.use((socket, next) => {
      void this.authenticate(socket as ChatSocket).then(
        () => next(),
        () => next(connectError()),
      );
    });
  }

  handleConnection(socket: ChatSocket): void {
    socket.on('chat:join', (payload: unknown, ack?: ChatJoinAck) => {
      if (typeof ack !== 'function') return;
      void this.join(socket, payload).then(ack);
    });
    socket.on('message:send', (payload: unknown, ack?: MessageSendAck) => {
      if (typeof ack !== 'function') return;
      void this.send(socket, payload).then(ack);
    });
  }

  handleDisconnect(socket: ChatSocket): void {
    if (socket.data.expiryTimer !== undefined) {
      clearTimeout(socket.data.expiryTimer);
    }
    delete socket.data.expiryTimer;
    delete socket.data.joinInFlight;
    delete socket.data.admittedChatId;
    delete socket.data.userId;
  }

  private async authenticate(socket: ChatSocket): Promise<void> {
    const token = readCookie(
      socket.handshake.headers.cookie,
      ACCESS_TOKEN_COOKIE,
    );
    if (token === null) throw new ChatSocketError('UNAUTHENTICATED');

    const verified = await this.tokens.verifyWithMetadata(token);
    socket.data.userId = verified.user.sub;
    this.scheduleExpiry(socket, verified.expiresAt.getTime());
  }

  private scheduleExpiry(socket: ChatSocket, expiresAtMs: number): void {
    const schedule = (): void => {
      const remaining = expiresAtMs - Date.now();
      if (remaining <= 0) {
        socket.disconnect(true);
        return;
      }
      socket.data.expiryTimer = setTimeout(
        schedule,
        Math.min(remaining, MAX_TIMEOUT_MS),
      );
    };
    schedule();
  }

  private async join(
    socket: ChatSocket,
    rawPayload: unknown,
  ): Promise<ChatSocketAcknowledgement<ChatJoinData>> {
    try {
      const payload = parseChatJoinPayload(rawPayload);
      const userId = socket.data.userId;
      if (userId === undefined) throw new ChatSocketError('UNAUTHENTICATED');
      if (
        socket.data.admittedChatId !== undefined &&
        socket.data.admittedChatId !== payload.chatId
      ) {
        throw new ChatSocketError('CONFLICT');
      }

      let joining = socket.data.joinInFlight;
      if (joining === undefined) {
        socket.data.admittedChatId = payload.chatId;
        joining = this.admissions
          .authorize(userId, payload.chatId)
          .then(async (admission) => {
            await socket.join(roomName(payload.chatId, userId));
            return admission;
          });
        socket.data.joinInFlight = joining;
      }

      let admission: ChatJoinData;
      try {
        admission = await joining;
      } catch (error) {
        if (socket.data.joinInFlight === joining) {
          delete socket.data.joinInFlight;
          delete socket.data.admittedChatId;
        }
        throw error;
      }
      if (socket.data.joinInFlight === joining) {
        delete socket.data.joinInFlight;
      }
      return { ok: true, data: admission };
    } catch (error) {
      if (error instanceof ChatSocketError) return chatSocketFailure(error);
      this.logger.error({
        operation: 'chat:join',
        outcome: 'failed',
        errorClass:
          error instanceof Error ? error.constructor.name : 'UnknownError',
      });
      return chatSocketFailure('INTERNAL_ERROR');
    }
  }

  private async send(
    socket: ChatSocket,
    rawPayload: unknown,
  ): Promise<ChatSocketAcknowledgement<MessageSendData>> {
    try {
      const payload = parseMessageSendPayload(rawPayload);
      const userId = socket.data.userId;
      if (userId === undefined) throw new ChatSocketError('UNAUTHENTICATED');
      if (socket.data.admittedChatId !== payload.chatId) {
        throw new ChatSocketError('CONFLICT');
      }

      const result = await this.messages.send({
        chatId: payload.chatId,
        senderUserId: userId,
        clientMessageId: payload.clientMessageId,
        content: payload.content,
      });
      if (result.inserted) {
        this.emitMessage(
          socket,
          payload.chatId,
          result.recipientUserId,
          result.message,
        );
      }
      return { ok: true, data: result.message };
    } catch (error) {
      if (error instanceof ChatSocketError) return chatSocketFailure(error);
      if (error instanceof ChatCommandError) {
        return chatSocketFailure(error.code);
      }
      this.logInternalError('message:send', error);
      return chatSocketFailure('INTERNAL_ERROR');
    }
  }

  private emitMessage(
    socket: ChatSocket,
    chatId: string,
    recipientUserId: string,
    message: CommittedMessageDto,
  ): void {
    this.bestEffortEmit(() =>
      this.namespace
        ?.to(roomName(chatId, recipientUserId))
        .emit('message:new', message),
    );
    this.bestEffortEmit(() =>
      socket
        .to(roomName(chatId, message.senderUserId))
        .emit('message:new', message),
    );
  }

  private bestEffortEmit(emit: () => unknown): void {
    try {
      emit();
    } catch (error) {
      this.logInternalError('message:emit', error);
    }
  }

  private logInternalError(operation: string, error: unknown): void {
    this.logger.error({
      operation,
      outcome: 'failed',
      errorClass:
        error instanceof Error ? error.constructor.name : 'UnknownError',
    });
  }
}

export function roomName(chatId: string, userId: string): string {
  return `chat:${chatId}:user:${userId}`;
}

function connectError(): Error & {
  data: ReturnType<typeof chatSocketFailure>['error'];
} {
  const failure = chatSocketFailure('UNAUTHENTICATED');
  return Object.assign(new Error(failure.error.message), {
    data: failure.error,
  });
}

function readCookie(header: string | undefined, name: string): string | null {
  if (header === undefined) return null;
  let found: string | null = null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    if (found !== null) return null;
    try {
      found = decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return found === '' ? null : found;
}
