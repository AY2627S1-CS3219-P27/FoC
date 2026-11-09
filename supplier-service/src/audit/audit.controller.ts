import { AdminGuard, JwtAuthGuard } from '@foc/auth';
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import type { Page } from '../suppliers/supplier-view.js';
import {
  type AuditEntryView,
  AuditEntriesService,
} from './audit-entries.service.js';
import { ListAuditEntriesQueryDto } from './dto/list-audit-entries-query.dto.js';

/**
 * Reading the audit log is for admins only (F13.4): it shows who changed
 * what. There is no way to change or delete an entry (F14.5).
 */
@Controller('audit-entries')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AuditController {
  constructor(private readonly entries: AuditEntriesService) {}

  /** Entries, newest first, with optional filters and paging. */
  @Get()
  list(
    @Query() query: ListAuditEntriesQueryDto,
  ): Promise<Page<AuditEntryView>> {
    return this.entries.list(query);
  }
}
