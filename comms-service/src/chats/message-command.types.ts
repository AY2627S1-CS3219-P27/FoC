export interface CommittedMessageDto {
  messageId: string;
  sequence: number;
  senderUserId: string;
  content: string;
  timestamp: string;
  status: 'UNREAD' | 'READ';
}

export interface MessageSendCommand {
  chatId: string;
  senderUserId: string;
  clientMessageId: string;
  content: string;
}

export interface MessageSendResult {
  message: CommittedMessageDto;
  recipientUserId: string;
  inserted: boolean;
}
