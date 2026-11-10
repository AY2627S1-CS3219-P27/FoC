import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './user.entity.js';
import { UserUpdateAudit } from './user-update-audit.entity.js';
import { RefreshToken } from '../auth/refresh-token.entity.js';
import { UsersService } from './users.service.js';
import { UsersController } from './users.controller.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { OrderServiceClient } from '../order/order-service.client.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, UserUpdateAudit, RefreshToken]),
    AuthorizationModule,
  ],
  controllers: [UsersController],
  providers: [UsersService, OrderServiceClient],
  exports: [UsersService],
})
export class UsersModule {}
