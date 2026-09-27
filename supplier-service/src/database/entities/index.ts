import { BuildingNameKey } from './building-name-key.entity.js';
import { Building } from './building.entity.js';
import { Category } from './category.entity.js';
import { SupplierCategory } from './supplier-category.entity.js';
import { Supplier } from './supplier.entity.js';

export { BuildingNameKey } from './building-name-key.entity.js';
export { Building } from './building.entity.js';
export { Category } from './category.entity.js';
export { SupplierCategory } from './supplier-category.entity.js';
export { Supplier, SupplierKind, SupplierStatus } from './supplier.entity.js';

// Every TypeORM entity of the supplier schema.
export const databaseEntities: Function[] = [
  Building,
  BuildingNameKey,
  Category,
  Supplier,
  SupplierCategory,
];
