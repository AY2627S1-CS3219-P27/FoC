import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, type EntityManager, type EntityTarget, In } from 'typeorm';
import { CLOCK, type Clock, systemClock } from '../common/clock.js';
import {
  ErrorCode,
  type FieldViolation,
} from '../common/errors/error-response.js';
import { nameKey } from '../common/normalise/normalise.js';
import type { EnvironmentVariables } from '../config/environment.schema.js';
import {
  Building,
  Category,
  Supplier,
  SupplierCategory,
  SupplierOpeningInterval,
} from '../database/entities/index.js';
import {
  fromRows,
  type IntervalRow,
  openStatus,
  singaporeWeekMinute,
} from '../opening-hours/opening-hours.js';
import type { ListSuppliersQueryDto } from './dto/list-suppliers-query.dto.js';
import {
  type Page,
  type SupplierDetail,
  type SupplierListItem,
  toDetail,
  toListItem,
} from './supplier-view.js';

/** Escapes LIKE wildcards so a search for "100%" matches literally. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * The read side of the Supplier Service: listing with filters, sorting and
 * pagination (F5.1-F5.8.1, N3.1), and single lookup (F5.9, F15.1-F15.5).
 * Read-only, so callers may safely retry (F15.4). A database outage surfaces
 * as a retryable 503, never as not-found (F15.3), via the exception filter.
 */
@Injectable()
export class SupplierQueriesService {
  private readonly placeholder: string | null;

  constructor(
    private readonly dataSource: DataSource,
    config: ConfigService<EnvironmentVariables, true>,
    // The current time, replaceable in tests (opening hours, F2.5).
    @Optional() @Inject(CLOCK) private readonly clock: Clock = systemClock,
  ) {
    this.placeholder =
      config.get('PLACEHOLDER_IMAGE_URL', { infer: true }) || null;
  }

  async list(query: ListSuppliersQueryDto): Promise<Page<SupplierListItem>> {
    const { offset, limit } = query;
    const violations: FieldViolation[] = [];
    // One instant per request, for the filter and for every isOpenNow.
    const now = this.clock();
    const categoryIds = await this.usableIds(
      Category,
      query.categoryId,
      'categoryId',
      'category',
      violations,
    );
    const buildingIds = await this.usableIds(
      Building,
      query.buildingId,
      'buildingId',
      'building',
      violations,
    );
    if (violations.length > 0) {
      // Unknown ids are rejected rather than ignored (F5.8).
      throw new BadRequestException({
        code: ErrorCode.ValidationFailed,
        message: 'Request validation failed.',
        violations,
      });
    }
    // Only retired ids were given: no supplier can match (F5.8.1).
    if (categoryIds?.length === 0 || buildingIds?.length === 0) {
      return { items: [], total: 0, offset, limit, hasMore: false };
    }

    // Every filter narrows the same query, so they combine with AND (F5.5).
    const qb = this.dataSource
      .createQueryBuilder(Supplier, 's')
      .innerJoinAndSelect('s.building', 'b');
    if (query.name !== undefined) {
      qb.andWhere(`s.nameKey LIKE :name ESCAPE '\\'`, {
        name: `%${escapeLike(nameKey(query.name))}%`,
      });
    }
    if (categoryIds !== undefined) {
      // Suppliers having any of the categories (F5.4.2).
      qb.andWhere(
        `EXISTS (SELECT 1 FROM supplier_categories sc
                 WHERE sc.supplier_id = s.id
                   AND sc.category_id IN (:...categoryIds))`,
        { categoryIds },
      );
    }
    if (buildingIds !== undefined) {
      qb.andWhere('s.buildingId IN (:...buildingIds)', { buildingIds });
    }
    if (query.kind !== undefined) {
      qb.andWhere('s.kind IN (:...kinds)', { kinds: query.kind });
    }
    if (query.status !== undefined) {
      qb.andWhere('s.status = :status', { status: query.status });
    }
    if (query.openNow === true) {
      // Open around the clock, or inside an interval of today, or inside an
      // overnight interval that opened yesterday (F5.4.7, F2.3). Only true
      // filters; false is the same as not setting it.
      const week = singaporeWeekMinute(now);
      const day = Math.floor(week / 1440);
      qb.andWhere(
        `(s.open24Hours OR EXISTS (
           SELECT 1 FROM supplier_opening_intervals i
           WHERE i.supplier_id = s.id AND (
             (i.opens_at < i.closes_at AND i.day = :day
               AND :minute >= i.opens_at AND :minute < i.closes_at)
             OR (i.opens_at > i.closes_at AND (
               (i.day = :day AND :minute >= i.opens_at)
               OR (i.day = :previousDay AND :minute < i.closes_at)))))
         )`,
        { day, minute: week % 1440, previousDay: (day + 6) % 7 },
      );
    }

    const total = await qb.getCount();

    const direction = query.order === 'desc' ? 'DESC' : 'ASC';
    switch (query.sort) {
      case 'name':
        qb.orderBy('s.nameKey', direction).addOrderBy(
          'lower(b.short_name)',
          'ASC',
        );
        break;
      case 'building':
        qb.orderBy('lower(b.short_name)', direction).addOrderBy(
          's.nameKey',
          'ASC',
        );
        break;
      case 'createdAt':
        qb.orderBy('s.createdAt', direction);
        break;
      case 'updatedAt':
        qb.orderBy('s.updatedAt', direction);
        break;
      default:
        // Display name, "<name> @ <building short name>" (F5.3).
        qb.addSelect(
          `s.name_key || ' @ ' || lower(b.short_name)`,
          'display_key',
        ).orderBy('display_key', direction);
    }
    // The id always breaks ties, so page boundaries are stable (F5.3.1).
    qb.addOrderBy('s.id', 'ASC');

    const suppliers = await qb.offset(offset).limit(limit).getMany();
    const supplierIds = suppliers.map((s) => s.id);
    const categories = await this.categoriesOf(supplierIds);
    const intervals = await this.intervalsOf(supplierIds);

    return {
      items: suppliers.map((supplier) =>
        toListItem(
          supplier,
          categories.get(supplier.id) ?? [],
          this.placeholder,
          openStatus(
            intervals.get(supplier.id) ?? [],
            supplier.open24Hours,
            now,
          ).isOpenNow,
        ),
      ),
      total,
      offset,
      limit,
      hasMore: offset + suppliers.length < total,
    };
  }

  /**
   * One supplier, Active or Inactive (F5.7); unknown id → 404 (F5.9.1).
   * A caller inside a transaction passes its manager, so the read uses that
   * transaction's connection rather than a second one from the pool.
   */
  async get(
    id: string,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<SupplierDetail> {
    const supplier = await manager.findOne(Supplier, {
      where: { id },
      relations: { building: true },
    });
    if (!supplier) {
      throw new NotFoundException({
        code: ErrorCode.SupplierNotFound,
        message: `Supplier ${id} does not exist.`,
      });
    }
    const categories = await this.categoriesOf([id], manager);
    const rows = (await this.intervalsOf([id], manager)).get(id) ?? [];
    return toDetail(supplier, categories.get(id) ?? [], this.placeholder, {
      openingHours: fromRows(supplier.open24Hours, rows),
      status: openStatus(rows, supplier.open24Hours, this.clock()),
    });
  }

  /** Opening intervals per supplier, in one query for a whole page. */
  private async intervalsOf(
    supplierIds: string[],
    manager: EntityManager = this.dataSource.manager,
  ): Promise<Map<string, IntervalRow[]>> {
    const bySupplier = new Map<string, IntervalRow[]>();
    if (supplierIds.length === 0) {
      return bySupplier;
    }
    const rows = await manager.find(SupplierOpeningInterval, {
      where: { supplierId: In(supplierIds) },
    });
    for (const { supplierId, day, opensAt, closesAt } of rows) {
      const list = bySupplier.get(supplierId) ?? [];
      list.push({ day, opensAt, closesAt });
      bySupplier.set(supplierId, list);
    }
    return bySupplier;
  }

  /**
   * The non-retired ids among those requested, or undefined when the filter
   * was not given. Ids that do not exist are reported as violations.
   */
  private async usableIds(
    entity: EntityTarget<Building | Category>,
    requested: string[] | undefined,
    field: string,
    label: string,
    violations: FieldViolation[],
  ): Promise<string[] | undefined> {
    if (requested === undefined) {
      return undefined;
    }
    // Compared lower-case: PostgreSQL returns UUIDs lower-case.
    const ids = [...new Set(requested.map((id) => id.toLowerCase()))];
    const found = await this.dataSource.manager.findBy(entity, {
      id: In(ids),
    });
    for (const id of ids) {
      if (!found.some((row) => row.id === id)) {
        violations.push({ field, reason: `${label} ${id} does not exist` });
      }
    }
    return found.filter((row) => row.retiredAt === null).map((row) => row.id);
  }

  /** Categories per supplier, in one query for a whole page. */
  private async categoriesOf(
    supplierIds: string[],
    manager: EntityManager = this.dataSource.manager,
  ): Promise<Map<string, Category[]>> {
    const bySupplier = new Map<string, Category[]>();
    if (supplierIds.length === 0) {
      return bySupplier;
    }
    const links = await manager.find(SupplierCategory, {
      where: { supplierId: In(supplierIds) },
      relations: { category: true },
    });
    for (const link of links) {
      const list = bySupplier.get(link.supplierId) ?? [];
      list.push(link.category!);
      bySupplier.set(link.supplierId, list);
    }
    return bySupplier;
  }
}
