import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isUUID } from 'class-validator';
import { DataSource, type EntityManager, In, Not } from 'typeorm';
import { recordAudit } from '../audit/record-audit.js';
import { loadSupplierSnapshot } from '../audit/supplier-snapshot.js';
import {
  ErrorCode,
  type FieldViolation,
} from '../common/errors/error-response.js';
import { nameKey, normaliseFloor } from '../common/normalise/normalise.js';
import type { EnvironmentVariables } from '../config/environment.schema.js';
import {
  Brand,
  Building,
  Category,
  Supplier,
  SupplierCategory,
  SupplierOpeningInterval,
  SupplierStatus,
} from '../database/entities/index.js';
import { isUniqueViolation } from '../database/postgres-errors.js';
import { type OpeningHours, toRows } from '../opening-hours/opening-hours.js';
import type { SupplierInputDto } from './dto/supplier-input.dto.js';
import {
  type CampusBox,
  checkSupplierInput,
  checkSupplierPatch,
} from './supplier-input.rules.js';

/** What a supplier already references; F1.8 lets these stay retired. */
interface CurrentReferences {
  buildingId: string;
  brandId: string | null;
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
   * The field-rule problems of a raw submission (F1.2, F1.6, campus box),
   * without touching the database. Empty when the fields are valid.
   */
  async fieldViolations(input: unknown): Promise<FieldViolation[]> {
    const checked = await checkSupplierInput(input, this.campus);
    return checked.valid ? [] : checked.violations;
  }

  /** Whether any supplier exists at all, active or not. */
  hasAny(): Promise<boolean> {
    return this.dataSource.getRepository(Supplier).exists();
  }

  /** Whether a supplier with this duplicate key (F1.5) already exists. */
  exists(
    name: string,
    buildingId: string,
    floor: string,
    within?: EntityManager,
  ): Promise<boolean> {
    return (within ?? this.dataSource.manager).exists(Supplier, {
      where: {
        nameKey: nameKey(name),
        buildingId,
        floor: normaliseFloor(floor),
      },
    });
  }

  /**
   * Checks a proposed new supplier against every rule a create applies (field
   * rules, references, campus box), reporting every problem at once, without
   * saving anything. Returns the validated, normalised values. Used to file a
   * creation request (F7.1). Given a transaction, the building and category
   * rows stay share-locked until it ends, so the caller can save the request
   * before they could be retired.
   */
  async validateNew(
    input: unknown,
    within?: EntityManager,
  ): Promise<SupplierInputDto> {
    const checked = await checkSupplierInput(input, this.campus);
    return this.inTransaction(within, async (manager) => {
      const violations = checked.valid ? [] : [...checked.violations];
      violations.push(...(await referenceViolations(manager, input)));
      if (!checked.valid || violations.length > 0) {
        throw validationFailed(violations);
      }
      return checked.value;
    });
  }

  /**
   * Checks a proposed edit against every rule an admin edit applies, without
   * saving anything (F8.1): unknown supplier (404), stale version (409),
   * every field and reference problem at once (400), and whether the edited
   * record would duplicate another supplier (409, F1.5.1). Returns the
   * validated, normalised changes. Used to file an update request; the
   * supplier is share-locked so it cannot change until the request is saved.
   */
  async validatePatch(
    id: string,
    expectedVersion: number,
    input: unknown,
    within?: EntityManager,
  ): Promise<SupplierInputDto> {
    const checked = await checkSupplierPatch(input, this.campus);

    return this.inTransaction(within, async (manager) => {
      const supplier = await lockForChange(
        manager,
        id,
        expectedVersion,
        'pessimistic_read',
      );
      const violations = checked.valid ? [] : [...checked.violations];
      violations.push(
        ...(await referenceViolations(
          manager,
          input,
          await currentReferences(manager, supplier),
        )),
      );
      if (!checked.valid || violations.length > 0) {
        throw validationFailed(violations);
      }

      const dto = checked.value;
      if (
        dto.name !== undefined ||
        dto.buildingId !== undefined ||
        dto.floor !== undefined
      ) {
        const duplicate = await manager.exists(Supplier, {
          where: {
            id: Not(id),
            nameKey:
              dto.name !== undefined ? nameKey(dto.name) : supplier.nameKey,
            buildingId: dto.buildingId ?? supplier.buildingId,
            floor: dto.floor ?? supplier.floor,
          },
        });
        if (duplicate) {
          throw duplicateSupplier();
        }
      }
      return dto;
    });
  }

  /**
   * Creates an Active supplier at version 1 (F7.5, F9.1, F1.3.1). The input
   * is untrusted: the seed import and the admin API both pass raw values.
   * Given a transaction, it runs inside it (approving a creation request
   * applies the create and records the approval atomically, F6.8).
   */
  async create(input: unknown, within?: EntityManager): Promise<Supplier> {
    const checked = await checkSupplierInput(input, this.campus);

    return withDuplicateMapped(() =>
      this.inTransaction(within, async (manager) => {
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
          brandId: dto.brandId ?? null,
          floor: dto.floor,
          locationDescription: dto.locationDescription,
          latitude: dto.coordinates.latitude,
          longitude: dto.coordinates.longitude,
          photoUrl: dto.photoUrl ?? null,
          open24Hours: dto.openingHours
            ? toRows(dto.openingHours).open24Hours
            : false,
          status: SupplierStatus.Active,
        });
        const saved = await manager.save(supplier);
        await writeIntervals(manager, saved.id, dto.openingHours ?? null);
        await manager.insert(
          SupplierCategory,
          dto.categoryIds.map((categoryId) => ({
            supplierId: saved.id,
            categoryId,
          })),
        );
        // In the same transaction as the create (F14.4).
        const after = await loadSupplierSnapshot(manager, saved.id);
        await recordAudit(manager, {
          action: 'supplier.created',
          targetType: 'supplier',
          targetId: saved.id,
          after,
          version: after.version as number,
        });
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
    within?: EntityManager,
  ): Promise<void> {
    const checked = await checkSupplierPatch(input, this.campus);

    await withDuplicateMapped(() =>
      this.inTransaction(within, async (manager) => {
        const supplier = await lockForChange(manager, id, expectedVersion);
        const violations = checked.valid ? [] : [...checked.violations];
        violations.push(
          ...(await referenceViolations(
            manager,
            input,
            await currentReferences(manager, supplier),
          )),
        );
        if (!checked.valid || violations.length > 0) {
          throw validationFailed(violations);
        }

        const before = await loadSupplierSnapshot(manager, id);
        const dto = checked.value;
        const changes: Partial<Supplier> = {};
        if (dto.name !== undefined) {
          changes.name = dto.name;
          changes.nameKey = nameKey(dto.name);
        }
        if (dto.kind !== undefined) changes.kind = dto.kind;
        if (dto.buildingId !== undefined) changes.buildingId = dto.buildingId;
        if (dto.brandId !== undefined) changes.brandId = dto.brandId;
        if (dto.floor !== undefined) changes.floor = dto.floor;
        if (dto.locationDescription !== undefined) {
          changes.locationDescription = dto.locationDescription;
        }
        if (dto.coordinates !== undefined) {
          changes.latitude = dto.coordinates.latitude;
          changes.longitude = dto.coordinates.longitude;
        }
        if (dto.photoUrl !== undefined) changes.photoUrl = dto.photoUrl;
        if (dto.openingHours !== undefined) {
          // The whole schedule is replaced; null removes it (F1.2.8).
          await manager.delete(SupplierOpeningInterval, { supplierId: id });
          await writeIntervals(manager, id, dto.openingHours);
          changes.open24Hours = dto.openingHours
            ? toRows(dto.openingHours).open24Hours
            : false;
        }

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
        const after = await loadSupplierSnapshot(manager, id);
        await recordAudit(manager, {
          action: 'supplier.updated',
          targetType: 'supplier',
          targetId: id,
          before,
          after,
          version: after.version as number,
        });
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
    within?: EntityManager,
  ): Promise<void> {
    await this.inTransaction(within, async (manager) => {
      const supplier = await lockForChange(manager, id, expectedVersion);
      if (supplier.status === status) {
        throw alreadyInStatus(status);
      }
      await applyStatus(manager, id, status);
    });
  }

  /**
   * Checks that a status-change request can be filed (F9.3.1): the supplier
   * exists (404) and does not already have the requested status (409). It is
   * share-locked until the request is saved, and its version is returned so
   * the request can record it (F6.2).
   */
  async checkStatusChange(
    id: string,
    status: SupplierStatus,
    within?: EntityManager,
  ): Promise<{ version: number }> {
    return this.inTransaction(within, async (manager) => {
      const supplier = await lockSupplier(manager, id, 'pessimistic_read');
      if (supplier.status === status) {
        throw alreadyInStatus(status);
      }
      return { version: supplier.version };
    });
  }

  /**
   * Sets the status of a supplier whatever its version, for approving a
   * status-change request (F9.4): only the status must differ, so a supplier
   * edited since the request was filed does not block it. The version still
   * goes up by one.
   */
  async setStatus(
    id: string,
    status: SupplierStatus,
    within?: EntityManager,
  ): Promise<void> {
    await this.inTransaction(within, async (manager) => {
      const supplier = await lockSupplier(manager, id, 'pessimistic_write');
      if (supplier.status === status) {
        throw alreadyInStatus(status);
      }
      await applyStatus(manager, id, status);
    });
  }

  /** Runs the work inside the given transaction, or in a new one. */
  private inTransaction<T>(
    within: EntityManager | undefined,
    work: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return within ? work(within) : this.dataSource.transaction(work);
  }
}

/**
 * Loads the supplier with a row lock held until the transaction ends, and
 * checks the version the change is based on (F14.3.1). A change takes the
 * exclusive lock; a check that only reads takes a shared one.
 */
async function lockForChange(
  manager: EntityManager,
  id: string,
  expectedVersion: number,
  mode: 'pessimistic_write' | 'pessimistic_read' = 'pessimistic_write',
): Promise<Supplier> {
  const supplier = await lockSupplier(manager, id, mode);
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

/** Loads the supplier with a row lock held until the transaction ends; 404 if it does not exist. */
async function lockSupplier(
  manager: EntityManager,
  id: string,
  mode: 'pessimistic_write' | 'pessimistic_read',
): Promise<Supplier> {
  const supplier = await manager.findOne(Supplier, {
    where: { id },
    lock: { mode },
  });
  if (!supplier) {
    throw new NotFoundException({
      code: ErrorCode.SupplierNotFound,
      message: `Supplier ${id} does not exist.`,
    });
  }
  return supplier;
}

/**
 * Sets the status, raising the version, and records it in the audit log
 * (F14.4). The caller holds the row lock.
 */
async function applyStatus(
  manager: EntityManager,
  id: string,
  status: SupplierStatus,
): Promise<void> {
  const before = await loadSupplierSnapshot(manager, id);
  await bumpVersion(manager, id, { status });
  const after = await loadSupplierSnapshot(manager, id);
  await recordAudit(manager, {
    action: 'supplier.status_changed',
    targetType: 'supplier',
    targetId: id,
    before,
    after,
    version: after.version as number,
  });
}

function alreadyInStatus(status: SupplierStatus): ConflictException {
  return new ConflictException({
    code: ErrorCode.InvalidStatusTransition,
    message: `The supplier is already ${status}.`,
  });
}

/** Stores the weekly intervals of opening hours; open 24 hours has none (F2.2). */
async function writeIntervals(
  manager: EntityManager,
  supplierId: string,
  hours: OpeningHours | null,
): Promise<void> {
  const { intervals } = hours ? toRows(hours) : { intervals: [] };
  if (intervals.length > 0) {
    await manager.insert(
      SupplierOpeningInterval,
      intervals.map((row) => ({ supplierId, ...row })),
    );
  }
}

/** The building, brand and categories the supplier references now (F1.8). */
async function currentReferences(
  manager: EntityManager,
  supplier: Supplier,
): Promise<CurrentReferences> {
  const links = await manager.findBy(SupplierCategory, {
    supplierId: supplier.id,
  });
  return {
    buildingId: supplier.buildingId,
    brandId: supplier.brandId,
    categoryIds: links.map((link) => link.categoryId),
  };
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
      throw duplicateSupplier();
    }
    throw error;
  }
}

function duplicateSupplier(): ConflictException {
  return new ConflictException({
    code: ErrorCode.DuplicateSupplier,
    message:
      'A supplier with the same name already exists on this floor of this building.',
  });
}

/**
 * Newly supplied building and category ids must exist and must not be
 * retired (F1.2.3, F1.2.4). Ids the supplier already references may stay
 * retired (F1.8). Ids that are not UUIDs are already reported by the field
 * rules, so they are skipped here.
 *
 * The rows are read with a shared lock (FOR SHARE) held until the write
 * commits, so a building or category being retired at the same moment
 * waits, and cannot be retired between this check and the change.
 */
async function referenceViolations(
  manager: EntityManager,
  input: unknown,
  current?: CurrentReferences,
): Promise<FieldViolation[]> {
  const raw = (typeof input === 'object' && input !== null ? input : {}) as {
    buildingId?: unknown;
    brandId?: unknown;
    categoryIds?: unknown;
  };
  const violations: FieldViolation[] = [];

  // Ids are compared lower-case: PostgreSQL returns UUIDs lower-case.
  if (typeof raw.buildingId === 'string' && isUUID(raw.buildingId)) {
    const building = await manager.findOne(Building, {
      where: { id: raw.buildingId.toLowerCase() },
      lock: { mode: 'pessimistic_read' },
    });
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

  if (typeof raw.brandId === 'string' && isUUID(raw.brandId)) {
    const brand = await manager.findOne(Brand, {
      where: { id: raw.brandId.toLowerCase() },
      lock: { mode: 'pessimistic_read' },
    });
    if (!brand) {
      violations.push({ field: 'brandId', reason: 'brand does not exist' });
    } else if (brand.retiredAt !== null && brand.id !== current?.brandId) {
      violations.push({
        field: 'brandId',
        reason: 'brand is retired and cannot be chosen',
      });
    }
  }

  if (Array.isArray(raw.categoryIds)) {
    const ids = [
      ...new Set(
        raw.categoryIds
          .filter((id): id is string => typeof id === 'string' && isUUID(id))
          .map((id) => id.toLowerCase()),
      ),
    ];
    const found =
      ids.length > 0
        ? await manager.find(Category, {
            where: { id: In(ids) },
            lock: { mode: 'pessimistic_read' },
          })
        : [];
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
