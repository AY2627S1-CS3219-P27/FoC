import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, type EntityTarget, In } from 'typeorm';
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
} from '../database/entities/index.js';
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
  ) {
    this.placeholder =
      config.get('PLACEHOLDER_IMAGE_URL', { infer: true }) || null;
  }

  async list(query: ListSuppliersQueryDto): Promise<Page<SupplierListItem>> {
    const { offset, limit } = query;
    const violations: FieldViolation[] = [];
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
    const categories = await this.categoriesOf(suppliers.map((s) => s.id));

    return {
      items: suppliers.map((supplier) =>
        toListItem(
          supplier,
          categories.get(supplier.id) ?? [],
          this.placeholder,
        ),
      ),
      total,
      offset,
      limit,
      hasMore: offset + suppliers.length < total,
    };
  }

  /** One supplier, Active or Inactive (F5.7); unknown id → 404 (F5.9.1). */
  async get(id: string): Promise<SupplierDetail> {
    const supplier = await this.dataSource.manager.findOne(Supplier, {
      where: { id },
      relations: { building: true },
    });
    if (!supplier) {
      throw new NotFoundException({
        code: ErrorCode.SupplierNotFound,
        message: `Supplier ${id} does not exist.`,
      });
    }
    const categories = await this.categoriesOf([id]);
    return toDetail(supplier, categories.get(id) ?? [], this.placeholder);
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
    const ids = [...new Set(requested)];
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
  ): Promise<Map<string, Category[]>> {
    const bySupplier = new Map<string, Category[]>();
    if (supplierIds.length === 0) {
      return bySupplier;
    }
    const links = await this.dataSource.manager.find(SupplierCategory, {
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
