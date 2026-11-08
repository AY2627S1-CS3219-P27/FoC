import { Injectable, Logger } from '@nestjs/common';
import type { Namespace } from 'socket.io';
import type { ChatCloseReason } from '../database/entities/chat.entity.js';
import { commsMetrics } from '../observability/comms-metrics.js';
import type {
  ChatArchivedEvent,
  ChatClosingEvent,
  ChatServerEvents,
} from './chat-socket.protocol.js';

export interface ClosingNotification {
  chatId: string;
  requesterUserId: string;
  courierUserId: string;
  closesAt: Date;
  closeReason: ChatCloseReason;
}

export interface ArchivedNotification {
  chatId: string;
  archiveId: string;
  requesterUserId: string;
  courierUserId: string;
  archivedAt: Date;
}

/** Best-effort participant-room publication over the configured adapter. */
@Injectable()
export class ChatRealtimePublisher {
  private readonly logger = new Logger(ChatRealtimePublisher.name);
  private namespace?: Namespace;

  bindNamespace(namespace: Namespace): void {
    this.namespace = namespace;
  }

  publishClosing(notification: ClosingNotification): void {
    const event: ChatClosingEvent = {
      chatId: notification.chatId,
      closesAt: notification.closesAt.toISOString(),
      closeReason: notification.closeReason,
    };
    this.emitToParticipants('closing', 'chat:closing', notification, event);
  }

  publishArchived(notification: ArchivedNotification): void {
    const event: ChatArchivedEvent = {
      chatId: notification.chatId,
      archiveId: notification.archiveId,
      archivedAt: notification.archivedAt.toISOString(),
    };
    this.emitToParticipants('archived', 'chat:archived', notification, event);
  }

  private emitToParticipants<Event extends keyof ChatServerEvents>(
    metricEvent: 'closing' | 'archived',
    eventName: Event,
    participants: {
      chatId: string;
      requesterUserId: string;
      courierUserId: string;
    },
    payload: Parameters<ChatServerEvents[Event]>[0],
  ): void {
    try {
      if (this.namespace === undefined) {
        throw new Error('Socket namespace is unavailable');
      }
      this.namespace
        .to([
          roomName(participants.chatId, participants.requesterUserId),
          roomName(participants.chatId, participants.courierUserId),
        ])
        .emit(eventName, payload);
      commsMetrics.socketNotification(metricEvent, 'emitted');
    } catch (error) {
      commsMetrics.socketNotification(metricEvent, 'failed');
      this.logger.error({
        operation: `${eventName}:emit`,
        outcome: 'failed',
        errorClass:
          error instanceof Error ? error.constructor.name : 'UnknownError',
      });
    }
  }
}

export function roomName(chatId: string, userId: string): string {
  return `chat:${chatId}:user:${userId}`;
}
