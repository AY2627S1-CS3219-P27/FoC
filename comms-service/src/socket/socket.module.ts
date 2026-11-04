import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { ChatAdmissionService } from './chat-admission.service.js';
import { ChatGateway } from './chat.gateway.js';

@Module({
  imports: [DatabaseModule],
  providers: [ChatAdmissionService, ChatGateway],
})
export class SocketModule {}
