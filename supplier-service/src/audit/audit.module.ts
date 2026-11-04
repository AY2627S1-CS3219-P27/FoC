import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditContextInterceptor } from './audit-context.interceptor.js';

/** Tells the services who is acting, for the audit log (F14.4). */
@Module({
  providers: [{ provide: APP_INTERCEPTOR, useClass: AuditContextInterceptor }],
})
export class AuditModule {}
