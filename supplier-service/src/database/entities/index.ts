import { OutboxEvent } from '@foc/outbox/outbox-event.entity';
import { BuildingNameKey } from './building-name-key.entity.js';
import { AuditEntry } from './audit-entry.entity.js';
import { Brand } from './brand.entity.js';
import { Building } from './building.entity.js';
import { Category } from './category.entity.js';
import { IdempotencyKey } from './idempotency-key.entity.js';
import { InboxEvent } from './inbox-event.entity.js';
import { SupplierCategory } from './supplier-category.entity.js';
import { SupplierOpeningInterval } from './supplier-opening-interval.entity.js';
import { SupplierRequest } from './supplier-request.entity.js';
import { Supplier } from './supplier.entity.js';
import { Venue } from './venue.entity.js';

export {
  AUDIT_TARGET_TYPES,
  AuditEntry,
  type AuditTargetType,
} from './audit-entry.entity.js';
export { Brand } from './brand.entity.js';
export { BuildingNameKey } from './building-name-key.entity.js';
export { Building } from './building.entity.js';
export { Category } from './category.entity.js';
export { IdempotencyKey } from './idempotency-key.entity.js';
export { InboxEvent } from './inbox-event.entity.js';
export { OutboxEvent } from '@foc/outbox/outbox-event.entity';
export { SupplierCategory } from './supplier-category.entity.js';
export { SupplierOpeningInterval } from './supplier-opening-interval.entity.js';
export {
  RequestState,
  RequestType,
  SupplierRequest,
} from './supplier-request.entity.js';
export { Supplier, SupplierKind, SupplierStatus } from './supplier.entity.js';
export { Venue } from './venue.entity.js';

// Every TypeORM entity of the supplier schema, plus the outbox table that
// @foc/outbox reads.
export const databaseEntities: Function[] = [
  AuditEntry,
  Brand,
  Building,
  BuildingNameKey,
  Category,
  IdempotencyKey,
  Supplier,
  SupplierCategory,
  SupplierOpeningInterval,
  SupplierRequest,
  Venue,
  InboxEvent,
  OutboxEvent,
];
