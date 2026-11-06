import { CreateSupplierSchema1790467200000 } from './1790467200000-create-supplier-schema.js';
import { CreateSupplierRequests1790640000000 } from './1790640000000-create-supplier-requests.js';
import { AddPendingTargetIndex1790726400000 } from './1790726400000-add-pending-target-index.js';
import { IndexRequestsBySubmitter1790812800000 } from './1790812800000-index-requests-by-submitter.js';
import { StoreUserIdsAsUuid1790899200000 } from './1790899200000-store-user-ids-as-uuid.js';
import { CreateInboxAndOutboxEvents1790985600000 } from './1790985600000-create-inbox-and-outbox-events.js';
import { AddOpeningHours1791072000000 } from './1791072000000-add-opening-hours.js';
import { AddBrands1791158400000 } from './1791158400000-add-brands.js';
import { AddIdempotencyKeys1791244800000 } from './1791244800000-add-idempotency-keys.js';
import { AddAuditEntries1791331200000 } from './1791331200000-add-audit-entries.js';
import { CreateVenues1791417600000 } from './1791417600000-create-venues.js';
import { CorrectE3E4Coordinates1791504000000 } from './1791504000000-correct-e3-e4-coordinates.js';
import { RenameAs8Building1791590400000 } from './1791590400000-rename-as8-building.js';

// Every migration, in the order it must run. Generate new ones with
// `npm run migration:generate -- src/database/migrations/<Name>` and list the
// generated class here.
export const databaseMigrations: Function[] = [
  CreateSupplierSchema1790467200000,
  CreateSupplierRequests1790640000000,
  AddPendingTargetIndex1790726400000,
  IndexRequestsBySubmitter1790812800000,
  StoreUserIdsAsUuid1790899200000,
  CreateInboxAndOutboxEvents1790985600000,
  AddOpeningHours1791072000000,
  AddBrands1791158400000,
  AddIdempotencyKeys1791244800000,
  AddAuditEntries1791331200000,
  CreateVenues1791417600000,
  CorrectE3E4Coordinates1791504000000,
  RenameAs8Building1791590400000,
];
