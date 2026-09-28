import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, type Repository } from 'typeorm';
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

  async create(name: string): Promise<Category> {
    const category = this.categories.create({
      id: randomUUID(),
      name: name.trim(),
      nameKey: nameKey(name),
      retiredAt: null,
    });
    return this.withDuplicateNameMapped(() => this.categories.save(category));
  }

  async rename(id: string, name: string): Promise<Category> {
    const category = await this.categories.findOneBy({ id });
    if (!category) {
      throw categoryNotFound(id);
    }
    category.name = name.trim();
    category.nameKey = nameKey(name);
    return this.withDuplicateNameMapped(() => this.categories.save(category));
  }

  /**
   * Retires a category: suppliers keep it (F11.3), but it is no longer
   * listed or selectable (F11.3.1). Retiring twice is a no-op.
   */
  async retire(id: string): Promise<Category> {
    const category = await this.categories.findOneBy({ id });
    if (!category) {
      throw categoryNotFound(id);
    }
    if (category.retiredAt !== null) {
      return category;
    }
    category.retiredAt = new Date();
    return this.categories.save(category);
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
