import type {
  Brand,
  Building,
  Category,
  Supplier,
  SupplierRequest,
} from '../database/entities/index.js';
import { fromRows, type IntervalRow } from '../opening-hours/opening-hours.js';

/** A record as stored in `before` and `after`: plain JSON, no Date objects. */
export type AuditSnapshot = Record<string, unknown>;

const iso = (date: Date | null | undefined) => date?.toISOString() ?? null;

/** A supplier with its categories and opening hours (F1.2, F2). */
export function supplierSnapshot(
  supplier: Supplier,
  categoryIds: string[],
  intervals: IntervalRow[],
): AuditSnapshot {
  return {
    id: supplier.id,
    name: supplier.name,
    kind: supplier.kind,
    buildingId: supplier.buildingId,
    brandId: supplier.brandId,
    categoryIds: [...categoryIds].sort(),
    floor: supplier.floor,
    locationDescription: supplier.locationDescription,
    coordinates: {
      latitude: supplier.latitude,
      longitude: supplier.longitude,
    },
    photoUrl: supplier.photoUrl,
    openingHours: fromRows(supplier.open24Hours, intervals),
    status: supplier.status,
    version: supplier.version,
  };
}

/** A supplier request (F6). */
export function requestSnapshot(request: SupplierRequest): AuditSnapshot {
  return {
    id: request.id,
    type: request.type,
    state: request.state,
    supplierId: request.supplierId,
    supplierVersion: request.supplierVersion,
    values: request.payload,
    submittedBy: request.submittedBy,
    submittedAt: iso(request.submittedAt),
    resolvedBy: request.resolvedBy,
    resolvedAt: iso(request.resolvedAt),
    denialReason: request.denialReason,
    createdSupplierId: request.createdSupplierId,
  };
}

export function categorySnapshot(category: Category): AuditSnapshot {
  return {
    id: category.id,
    name: category.name,
    retiredAt: iso(category.retiredAt),
  };
}

export function brandSnapshot(brand: Brand): AuditSnapshot {
  return {
    id: brand.id,
    name: brand.name,
    retiredAt: iso(brand.retiredAt),
  };
}

export function buildingSnapshot(building: Building): AuditSnapshot {
  return {
    id: building.id,
    canonicalName: building.canonicalName,
    shortName: building.shortName,
    aliases: [...building.aliases],
    coordinates: { latitude: building.latitude, longitude: building.longitude },
    retiredAt: iso(building.retiredAt),
  };
}
