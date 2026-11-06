import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { ChatCursorCodec } from './chat-cursor.codec.js';
import { ChatQueryService } from './chat-query.service.js';
import { ChatsController } from './chats.controller.js';

@Module({
  imports: [DatabaseModule],
  controllers: [ChatsController],
  providers: [ChatCursorCodec, ChatQueryService],
  exports: [ChatQueryService],
})
export class ChatsModule {}
