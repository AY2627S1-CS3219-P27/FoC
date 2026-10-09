import { Module } from '@nestjs/common';
import { AuthKeyService } from './auth-key.service.js';

@Module({
  providers: [AuthKeyService],
  exports: [AuthKeyService],
})
export class AuthKeyModule {}
