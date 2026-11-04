import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuditEntry } from '../database/entities/index.js';
import type { Page } from '../suppliers/supplier-view.js';
import type { ListAuditEntriesQueryDto } from './dto/list-audit-entries-query.dto.js';

/** An audit entry as the API returns it. */
export interface AuditEntryView {
  /** Increases with every change, so it orders the log. */
  id: string;
  occurredAt: Date;
  /** The acting user; null where the system acted (the seed). */
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  version: number | null;
}

/** Reading the audit log (F14.4). Read-only: the log is append-only (F14.5). */
@Injectable()
export class AuditEntriesService {
  constructor(private readonly dataSource: DataSource) {}

  /** Entries, newest first, filtered and paged. */
  async list(query: ListAuditEntriesQueryDto): Promise<Page<AuditEntryView>> {
    const { offset, limit } = query;
    const [entries, total] = await this.dataSource.manager.findAndCount(
      AuditEntry,
      {
        where: {
          ...(query.targetType !== undefined && {
            targetType: query.targetType,
          }),
          ...(query.targetId !== undefined && { targetId: query.targetId }),
          ...(query.actorId !== undefined && { actorId: query.actorId }),
          ...(query.action !== undefined && { action: query.action }),
        },
        order: { id: 'DESC' },
        skip: offset,
        take: limit,
      },
    );
    return {
      items: entries.map(toView),
      total,
      offset,
      limit,
      hasMore: offset + entries.length < total,
    };
  }
}

function toView(entry: AuditEntry): AuditEntryView {
  return {
    id: entry.id,
    occurredAt: entry.occurredAt,
    actorId: entry.actorId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    before: entry.before,
    after: entry.after,
    version: entry.version,
  };
}
