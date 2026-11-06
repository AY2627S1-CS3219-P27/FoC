export interface MessagesReadCommand {
  chatId: string;
  readerUserId: string;
  throughSequence: number;
}

export interface MessagesReadData {
  chatId: string;
  throughSequence: number;
  highestReadSequence: number | null;
  readAt: string | null;
}

export interface MessagesReadReceipt extends MessagesReadData {
  readerUserId: string;
}

export interface MessagesReadResult {
  data: MessagesReadData;
  affectedSenderUserId: string;
  changed: boolean;
}
