import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditContextInterceptor } from './audit-context.interceptor.js';
import { AuditController } from './audit.controller.js';
import { AuditEntriesService } from './audit-entries.service.js';

/**
 * The audit log (F14.4): tells the services who is acting, and lets admins
 * read the entries.
 */
@Module({
  controllers: [AuditController],
  providers: [
    AuditEntriesService,
    { provide: APP_INTERCEPTOR, useClass: AuditContextInterceptor },
  ],
})
export class AuditModule {}
