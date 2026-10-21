import { Module } from '@nestjs/common';
import { RoleBlocksController } from './role-blocks.controller.js';
import { RoleBlocksService } from './role-blocks.service.js';

// The guard (FocAuthModule) and the DB (DbModule) are global.
@Module({ controllers: [RoleBlocksController], providers: [RoleBlocksService] })
export class RoleBlocksModule {}
