export type ChatCommandErrorCode = 'NOT_FOUND' | 'CHAT_ARCHIVED' | 'CONFLICT';

export class ChatCommandError extends Error {
  constructor(readonly code: ChatCommandErrorCode) {
    super(code);
  }
}
