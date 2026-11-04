import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { MessageCommandService } from '../chats/message-command.service.js';
import { ChatAdmissionService } from './chat-admission.service.js';
import { ChatGateway } from './chat.gateway.js';

@Module({
  imports: [DatabaseModule],
  providers: [ChatAdmissionService, MessageCommandService, ChatGateway],
})
export class SocketModule {}
