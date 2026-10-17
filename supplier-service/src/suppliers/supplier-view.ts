import { displayName } from '../common/normalise/normalise.js';
import type {
  Category,
  Supplier,
  SupplierKind,
  SupplierStatus,
} from '../database/entities/index.js';

export interface CategoryRef {
  id: string;
  name: string;
}

/** One entry of the supplier listing (F5.1). */
export interface SupplierListItem {
  id: string;
  displayName: string;
  name: string;
  /** Brands arrive in step 14 (F3). */
  brand: null;
  kind: SupplierKind;
  categories: CategoryRef[];
  building: { id: string; shortName: string };
  floor: string;
  status: SupplierStatus;
  /** Not applicable until opening hours exist (F2.5.1, step 13). */
  isOpenNow: null;
  thumbnailUrl: string | null;
}

/**
 * A single supplier (F5.9): every F1.2 and F1.3 field. It is also what other
 * services rely on to keep their own snapshot (F15.1).
 */
export interface SupplierDetail extends Omit<SupplierListItem, 'building'> {
  building: { id: string; shortName: string; canonicalName: string };
  locationDescription: string;
  coordinates: { latitude: number; longitude: number };
  /** Not applicable until opening hours exist (F2.5.1, step 13). */
  openingHours: null;
  nextChangeAt: null;
  /** Image variants; the original stands in until variants exist (F17.3). */
  images: { original: string; thumbnail: string } | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** A page of a collection (N3.1.3). */
export interface Page<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

/** The photo, else the configured placeholder (F1.2.9), else null. */
function imageUrl(supplier: Supplier, placeholder: string | null) {
  return supplier.photoUrl ?? placeholder;
}

function categoryRefs(categories: Category[]): CategoryRef[] {
  return categories
    .map(({ id, name }) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** `supplier.building` must be loaded. */
export function toListItem(
  supplier: Supplier,
  categories: Category[],
  placeholder: string | null,
): SupplierListItem {
  const building = supplier.building!;
  return {
    id: supplier.id,
    displayName: displayName(supplier.name, building.shortName),
    name: supplier.name,
    brand: null,
    kind: supplier.kind,
    categories: categoryRefs(categories),
    building: { id: building.id, shortName: building.shortName },
    floor: supplier.floor,
    status: supplier.status,
    isOpenNow: null,
    thumbnailUrl: imageUrl(supplier, placeholder),
  };
}

/** `supplier.building` must be loaded. */
export function toDetail(
  supplier: Supplier,
  categories: Category[],
  placeholder: string | null,
): SupplierDetail {
  const building = supplier.building!;
  const image = imageUrl(supplier, placeholder);
  return {
    ...toListItem(supplier, categories, placeholder),
    building: {
      id: building.id,
      shortName: building.shortName,
      canonicalName: building.canonicalName,
    },
    locationDescription: supplier.locationDescription,
    coordinates: {
      latitude: supplier.latitude,
      longitude: supplier.longitude,
    },
    openingHours: null,
    nextChangeAt: null,
    images: image === null ? null : { original: image, thumbnail: image },
    version: supplier.version,
    createdAt: supplier.createdAt,
    updatedAt: supplier.updatedAt,
  };
}
