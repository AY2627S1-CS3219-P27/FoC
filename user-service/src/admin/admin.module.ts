import { Module } from '@nestjs/common';
import { AdminBootstrapService } from './admin-bootstrap.service.js';
import { UsersModule } from '../users/users.module.js';

@Module({
  imports: [UsersModule],
  providers: [AdminBootstrapService],
})
export class AdminModule {}