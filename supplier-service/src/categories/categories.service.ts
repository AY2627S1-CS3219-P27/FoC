import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type EntityManager, IsNull, type Repository } from 'typeorm';
import { recordAudit } from '../audit/record-audit.js';
import { categorySnapshot } from '../audit/snapshots.js';
import { ErrorCode } from '../common/errors/error-response.js';
import { nameKey } from '../common/normalise/normalise.js';
import { Category } from '../database/entities/index.js';
import { isUniqueViolation } from '../database/postgres-errors.js';

/**
 * The controlled set of supplier categories (F11). Names are unique among
 * non-retired categories, case-insensitively, enforced by a partial unique
 * index (F11.2.1); categories are retired, never deleted (F11.3).
 */
@Injectable()
export class CategoriesService {
  constructor(
    @InjectRepository(Category)
    private readonly categories: Repository<Category>,
  ) {}

  /** Non-retired categories, by name (F11.4, F11.3.1). */
  listActive(): Promise<Category[]> {
    return this.categories.find({
      where: { retiredAt: IsNull() },
      order: { nameKey: 'ASC' },
    });
  }

  findById(id: string): Promise<Category | null> {
    return this.categories.findOneBy({ id });
  }

  /** The non-retired category with this name, ignoring case; null if none. */
  findActiveByName(name: string): Promise<Category | null> {
    return this.categories.findOneBy({
      nameKey: nameKey(name),
      retiredAt: IsNull(),
    });
  }

  /**
   * The category with this name, ignoring case: the non-retired one if there
   * is one, else the most recently retired one; null if none ever existed.
   */
  async findByName(name: string): Promise<Category | null> {
    const matches = await this.categories.find({
      where: { nameKey: nameKey(name) },
      order: { createdAt: 'DESC' },
    });
    return (
      matches.find((category) => category.retiredAt === null) ??
      matches[0] ??
      null
    );
  }

  async create(name: string): Promise<Category> {
    const category = this.categories.create({
      id: randomUUID(),
      name: name.trim(),
      nameKey: nameKey(name),
      retiredAt: null,
    });
    // Saved with its audit entry in one transaction (F14.4).
    return this.withDuplicateNameMapped(() =>
      this.categories.manager.transaction(async (manager) => {
        const saved = await manager.save(category);
        await recordAudit(manager, {
          action: 'category.created',
          targetType: 'category',
          targetId: saved.id,
          after: categorySnapshot(saved),
        });
        return saved;
      }),
    );
  }

  async rename(id: string, name: string): Promise<Category> {
    return this.withDuplicateNameMapped(() =>
      this.categories.manager.transaction(async (manager) => {
        const category = await this.lock(manager, id);
        // Retired categories are frozen, as retired buildings are.
        if (category.retiredAt) {
          throw new ConflictException({
            code: ErrorCode.Conflict,
            message: 'A retired category cannot be renamed.',
          });
        }
        const before = categorySnapshot(category);
        category.name = name.trim();
        category.nameKey = nameKey(name);
        const saved = await manager.save(category);
        await recordAudit(manager, {
          action: 'category.renamed',
          targetType: 'category',
          targetId: id,
          before,
          after: categorySnapshot(saved),
        });
        return saved;
      }),
    );
  }

  /**
   * Retires a category: suppliers keep it (F11.3), but it is no longer
   * listed or selectable (F11.3.1). Retiring twice is a no-op.
   */
  async retire(id: string): Promise<Category> {
    return this.categories.manager.transaction(async (manager) => {
      const category = await this.lock(manager, id);
      if (category.retiredAt !== null) {
        return category; // already retired: nothing changed, nothing recorded
      }
      const before = categorySnapshot(category);
      category.retiredAt = new Date();
      const saved = await manager.save(category);
      await recordAudit(manager, {
        action: 'category.retired',
        targetType: 'category',
        targetId: id,
        before,
        after: categorySnapshot(saved),
      });
      return saved;
    });
  }

  /** The category, locked until the transaction ends; 404 if unknown. */
  private async lock(manager: EntityManager, id: string): Promise<Category> {
    const category = await manager.findOne(Category, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!category) {
      throw categoryNotFound(id);
    }
    return category;
  }

  private async withDuplicateNameMapped<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (isUniqueViolation(error, 'UQ_categories_name_key_active')) {
        throw new ConflictException({
          code: ErrorCode.DuplicateName,
          message: 'A category with this name already exists.',
        });
      }
      throw error;
    }
  }
}

function categoryNotFound(id: string): NotFoundException {
  return new NotFoundException({
    code: ErrorCode.NotFound,
    message: `Category ${id} does not exist.`,
  });
}
