import { ChatLog } from './chat-log.entity.js';
import { Chunk } from './chunk.entity.js';

export {
  CHAT_OUTCOMES,
  ChatLog,
  type ChatOutcome,
  type RetrievedSection,
} from './chat-log.entity.js';
export { Chunk, EMBEDDING_DIMENSIONS } from './chunk.entity.js';

export const databaseEntities: Function[] = [Chunk, ChatLog];
