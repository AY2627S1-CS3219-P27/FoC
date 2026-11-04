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
import { Brand } from '../database/entities/index.js';
import { isUniqueViolation } from '../database/postgres-errors.js';

/**
 * The controlled set of brands (F3). Names are unique among non-retired
 * brands, case-insensitively, enforced by a partial unique index (F3.2);
 * brands are retired, never deleted, and suppliers keep a retired brand
 * they already hold (F3.3.1, F1.8).
 */
@Injectable()
export class BrandsService {
  constructor(
    @InjectRepository(Brand)
    private readonly brands: Repository<Brand>,
  ) {}

  /** Non-retired brands, by name (F3.5). */
  listActive(): Promise<Brand[]> {
    return this.brands.find({
      where: { retiredAt: IsNull() },
      order: { nameKey: 'ASC' },
    });
  }

  async create(name: string): Promise<Brand> {
    const brand = this.brands.create({
      id: randomUUID(),
      name: name.trim(),
      nameKey: nameKey(name),
      retiredAt: null,
    });
    return this.withDuplicateNameMapped(() => this.brands.save(brand));
  }

  async rename(id: string, name: string): Promise<Brand> {
    const brand = await this.brands.findOneBy({ id });
    if (!brand) {
      throw brandNotFound(id);
    }
    // Retired brands are frozen, as retired categories and buildings are.
    if (brand.retiredAt) {
      throw new ConflictException({
        code: ErrorCode.Conflict,
        message: 'A retired brand cannot be renamed.',
      });
    }
    brand.name = name.trim();
    brand.nameKey = nameKey(name);
    return this.withDuplicateNameMapped(() => this.brands.save(brand));
  }

  /**
   * Retires a brand: suppliers keep it (F1.8), but it is no longer listed or
   * selectable (F3.3.1). Retiring twice is a no-op.
   */
  async retire(id: string): Promise<Brand> {
    const brand = await this.brands.findOneBy({ id });
    if (!brand) {
      throw brandNotFound(id);
    }
    if (brand.retiredAt !== null) {
      return brand;
    }
    brand.retiredAt = new Date();
    return this.brands.save(brand);
  }

  private async withDuplicateNameMapped<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (isUniqueViolation(error, 'UQ_brands_name_key_active')) {
        throw new ConflictException({
          code: ErrorCode.DuplicateName,
          message: 'A brand with this name already exists.',
        });
      }
      throw error;
    }
  }
}

function brandNotFound(id: string): NotFoundException {
  return new NotFoundException({
    code: ErrorCode.NotFound,
    message: `Brand ${id} does not exist.`,
  });
}
