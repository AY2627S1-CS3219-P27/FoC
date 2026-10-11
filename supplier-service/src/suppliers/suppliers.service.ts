import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { isUUID } from 'class-validator';
import { DataSource, type EntityManager, In, type Repository } from 'typeorm';
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
  SupplierStatus,
} from '../database/entities/index.js';
import { isUniqueViolation } from '../database/postgres-errors.js';
import { type CampusBox, checkSupplierInput } from './supplier-input.rules.js';

/**
 * Supplier writes. Each runs in one transaction (F14.1): the input is
 * checked against every rule, all problems are reported together (F1.6.1),
 * and nothing is persisted unless everything passes (F1.6).
 */
@Injectable()
export class SuppliersService {
  private readonly campus: CampusBox;

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Supplier)
    private readonly suppliers: Repository<Supplier>,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.campus = {
      minLatitude: config.get('CAMPUS_MIN_LATITUDE', { infer: true }),
      maxLatitude: config.get('CAMPUS_MAX_LATITUDE', { infer: true }),
      minLongitude: config.get('CAMPUS_MIN_LONGITUDE', { infer: true }),
      maxLongitude: config.get('CAMPUS_MAX_LONGITUDE', { infer: true }),
    };
  }

  async list(filters?: {
    status?: SupplierStatus;
    name?: string;
    buildingId?: string;
    kind?: string;
  }): Promise<Supplier[]> {
    const qb = this.suppliers
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.building', 'b')
      .leftJoinAndSelect('s.categoryLinks', 'sc')
      .leftJoinAndSelect('sc.category', 'c');

    if (filters?.status) {
      qb.andWhere('s.status = :status', { status: filters.status });
    }
    if (filters?.name) {
      qb.andWhere('s.nameKey LIKE :name', {
        name: `%${nameKey(filters.name)}%`,
      });
    }
    if (filters?.buildingId) {
      qb.andWhere('s.buildingId = :buildingId', {
        buildingId: filters.buildingId,
      });
    }
    if (filters?.kind) {
      qb.andWhere('s.kind = :kind', { kind: filters.kind });
    }

    qb.orderBy('s.name', 'ASC');
    return qb.getMany();
  }

  async findById(id: string): Promise<Supplier | null> {
    return this.suppliers.findOne({
      where: { id },
      relations: { building: true, categoryLinks: { category: true } },
    });
  }

  /**
   * Creates an Active supplier at version 1 (F7.5, F9.1, F1.3.1). The input
   * is untrusted: the seed import and the admin API both pass raw values.
   */
  async create(input: unknown): Promise<Supplier> {
    const checked = await checkSupplierInput(input, this.campus);

    try {
      return await this.dataSource.transaction(async (manager) => {
        const violations = checked.valid ? [] : [...checked.violations];
        violations.push(...(await referenceViolations(manager, input)));
        if (!checked.valid || violations.length > 0) {
          throw validationFailed(violations);
        }

        const dto = checked.value;
        const supplier = manager.create(Supplier, {
          id: randomUUID(),
          name: dto.name,
          nameKey: nameKey(dto.name),
          kind: dto.kind,
          buildingId: dto.buildingId,
          floor: dto.floor,
          locationDescription: dto.locationDescription,
          latitude: dto.coordinates.latitude,
          longitude: dto.coordinates.longitude,
          photoUrl: dto.photoUrl ?? null,
          status: SupplierStatus.Active,
        });
        const saved = await manager.save(supplier);
        await manager.insert(
          SupplierCategory,
          dto.categoryIds.map((categoryId) => ({
            supplierId: saved.id,
            categoryId,
          })),
        );
        return saved;
      });
    } catch (error) {
      // The unique constraint, not a prior lookup, decides duplicates, so two
      // concurrent identical submissions cannot both succeed (F1.5.2).
      if (isUniqueViolation(error, 'UQ_suppliers_name_key_building_floor')) {
        throw new ConflictException({
          code: ErrorCode.DuplicateSupplier,
          message:
            'A supplier with the same name already exists on this floor of this building.',
        });
      }
      throw error;
    }
  }
}

/**
 * Newly supplied building and category ids must exist and must not be
 * retired (F1.2.3, F1.2.4, F1.8). Ids that are not UUIDs are already
 * reported by the field rules, so they are skipped here.
 */
async function referenceViolations(
  manager: EntityManager,
  input: unknown,
): Promise<FieldViolation[]> {
  const raw = (typeof input === 'object' && input !== null ? input : {}) as {
    buildingId?: unknown;
    categoryIds?: unknown;
  };
  const violations: FieldViolation[] = [];

  if (typeof raw.buildingId === 'string' && isUUID(raw.buildingId)) {
    const building = await manager.findOneBy(Building, { id: raw.buildingId });
    if (!building) {
      violations.push({
        field: 'buildingId',
        reason: 'building does not exist',
      });
    } else if (building.retiredAt !== null) {
      violations.push({
        field: 'buildingId',
        reason: 'building is retired and cannot be chosen',
      });
    }
  }

  if (Array.isArray(raw.categoryIds)) {
    const ids = [
      ...new Set(
        raw.categoryIds.filter(
          (id): id is string => typeof id === 'string' && isUUID(id),
        ),
      ),
    ];
    const found =
      ids.length > 0 ? await manager.findBy(Category, { id: In(ids) }) : [];
    for (const id of ids) {
      const category = found.find((candidate) => candidate.id === id);
      if (!category) {
        violations.push({
          field: 'categoryIds',
          reason: `category ${id} does not exist`,
        });
      } else if (category.retiredAt !== null) {
        violations.push({
          field: 'categoryIds',
          reason: `category ${id} is retired and cannot be chosen`,
        });
      }
    }
  }

  return violations;
}

function validationFailed(violations: FieldViolation[]): BadRequestException {
  return new BadRequestException({
    code: ErrorCode.ValidationFailed,
    message: 'Request validation failed.',
    violations,
  });
}
