import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

// The guard (FocAuthModule) and the DB (DbModule) are global.
@Module({ controllers: [ReportsController], providers: [ReportsService] })
export class ReportsModule {}
