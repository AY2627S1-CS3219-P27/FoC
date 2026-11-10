import { EnablePgvector1793923200000 } from './1793923200000-enable-pgvector.js';
import { CreateChunks1794009600000 } from './1794009600000-create-chunks.js';
import { CreateChatLog1794096000000 } from './1794096000000-create-chat-log.js';

export const databaseMigrations: Function[] = [
  EnablePgvector1793923200000,
  CreateChunks1794009600000,
  CreateChatLog1794096000000,
];
