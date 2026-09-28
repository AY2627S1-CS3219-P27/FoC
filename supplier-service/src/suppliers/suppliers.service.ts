import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isUUID } from 'class-validator';
import { DataSource, type EntityManager, In } from 'typeorm';
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
import {
  type CampusBox,
  checkSupplierInput,
  checkSupplierPatch,
} from './supplier-input.rules.js';

/** What a supplier already references; F1.8 lets these stay retired. */
interface CurrentReferences {
  buildingId: string;
  categoryIds: string[];
}

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
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.campus = {
      minLatitude: config.get('CAMPUS_MIN_LATITUDE', { infer: true }),
      maxLatitude: config.get('CAMPUS_MAX_LATITUDE', { infer: true }),
      minLongitude: config.get('CAMPUS_MIN_LONGITUDE', { infer: true }),
      maxLongitude: config.get('CAMPUS_MAX_LONGITUDE', { infer: true }),
    };
  }

  /**
   * Creates an Active supplier at version 1 (F7.5, F9.1, F1.3.1). The input
   * is untrusted: the seed import and the admin API both pass raw values.
   */
  async create(input: unknown): Promise<Supplier> {
    const checked = await checkSupplierInput(input, this.campus);

    return withDuplicateMapped(() =>
      this.dataSource.transaction(async (manager) => {
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
      }),
    );
  }

  /**
   * An admin edit of one or more fields (F8.6, F8.1), based on the version
   * the admin last saw (F14.3). The row is locked for the whole check, so a
   * concurrent edit based on the same version is refused with a conflict
   * instead of silently lost (F14.3.1). Order of checks: unknown supplier
   * (404), stale version (409), then every field problem at once (400).
   */
  async update(
    id: string,
    expectedVersion: number,
    input: unknown,
  ): Promise<void> {
    const checked = await checkSupplierPatch(input, this.campus);

    await withDuplicateMapped(() =>
      this.dataSource.transaction(async (manager) => {
        const supplier = await lockForChange(manager, id, expectedVersion);
        const current: CurrentReferences = {
          buildingId: supplier.buildingId,
          categoryIds: (
            await manager.findBy(SupplierCategory, { supplierId: id })
          ).map((link) => link.categoryId),
        };

        const violations = checked.valid ? [] : [...checked.violations];
        violations.push(
          ...(await referenceViolations(manager, input, current)),
        );
        if (!checked.valid || violations.length > 0) {
          throw validationFailed(violations);
        }

        const dto = checked.value;
        const changes: Partial<Supplier> = {};
        if (dto.name !== undefined) {
          changes.name = dto.name;
          changes.nameKey = nameKey(dto.name);
        }
        if (dto.kind !== undefined) changes.kind = dto.kind;
        if (dto.buildingId !== undefined) changes.buildingId = dto.buildingId;
        if (dto.floor !== undefined) changes.floor = dto.floor;
        if (dto.locationDescription !== undefined) {
          changes.locationDescription = dto.locationDescription;
        }
        if (dto.coordinates !== undefined) {
          changes.latitude = dto.coordinates.latitude;
          changes.longitude = dto.coordinates.longitude;
        }
        if (dto.photoUrl !== undefined) changes.photoUrl = dto.photoUrl;

        if (dto.categoryIds !== undefined) {
          await manager.delete(SupplierCategory, { supplierId: id });
          await manager.insert(
            SupplierCategory,
            dto.categoryIds.map((categoryId) => ({
              supplierId: id,
              categoryId,
            })),
          );
        }
        // Every committed change bumps the version, even one that only
        // replaced the categories (F1.3.1). The unique constraint judges
        // the edited record as a whole (F1.5.1).
        await bumpVersion(manager, id, changes);
      }),
    );
  }

  /**
   * Activates or deactivates a supplier (F9.5), based on the version the
   * admin last saw (F14.3). Only Active <-> Inactive is allowed (F9.2).
   * Errands already created are untouched: they keep their own snapshot
   * (F9.6, F15.5).
   */
  async changeStatus(
    id: string,
    expectedVersion: number,
    status: SupplierStatus,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const supplier = await lockForChange(manager, id, expectedVersion);
      if (supplier.status === status) {
        throw new ConflictException({
          code: ErrorCode.InvalidStatusTransition,
          message: `The supplier is already ${status}.`,
        });
      }
      await bumpVersion(manager, id, { status });
    });
  }
}

/**
 * Loads the supplier with a row lock held until the transaction ends, and
 * checks the version the change is based on (F14.3.1).
 */
async function lockForChange(
  manager: EntityManager,
  id: string,
  expectedVersion: number,
): Promise<Supplier> {
  const supplier = await manager.findOne(Supplier, {
    where: { id },
    lock: { mode: 'pessimistic_write' },
  });
  if (!supplier) {
    throw new NotFoundException({
      code: ErrorCode.SupplierNotFound,
      message: `Supplier ${id} does not exist.`,
    });
  }
  if (supplier.version !== expectedVersion) {
    throw new ConflictException({
      code: ErrorCode.VersionConflict,
      message:
        'The supplier has changed since you loaded it. Reload it and try again.',
      currentVersion: supplier.version,
    });
  }
  return supplier;
}

/** Applies the column changes and increments the version, in one UPDATE. */
async function bumpVersion(
  manager: EntityManager,
  id: string,
  changes: Partial<Supplier>,
): Promise<void> {
  await manager
    .createQueryBuilder()
    .update(Supplier)
    .set({
      ...changes,
      version: () => 'version + 1',
      updatedAt: () => 'now()',
    })
    .where('id = :id', { id })
    .execute();
}

/**
 * Turns the duplicate constraint firing into 409 DUPLICATE_SUPPLIER. The
 * constraint, not a prior lookup, decides duplicates, so two concurrent
 * identical submissions cannot both succeed (F1.5.2).
 */
async function withDuplicateMapped<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
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

/**
 * Newly supplied building and category ids must exist and must not be
 * retired (F1.2.3, F1.2.4). Ids the supplier already references may stay
 * retired (F1.8). Ids that are not UUIDs are already reported by the field
 * rules, so they are skipped here.
 */
async function referenceViolations(
  manager: EntityManager,
  input: unknown,
  current?: CurrentReferences,
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
    } else if (
      building.retiredAt !== null &&
      building.id !== current?.buildingId
    ) {
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
      } else if (
        category.retiredAt !== null &&
        !current?.categoryIds.includes(id)
      ) {
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
