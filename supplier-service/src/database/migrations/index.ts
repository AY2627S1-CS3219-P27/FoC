import { CreateSupplierSchema1790467200000 } from './1790467200000-create-supplier-schema.js';
import { CreateSupplierRequests1790640000000 } from './1790640000000-create-supplier-requests.js';
import { AddPendingTargetIndex1790726400000 } from './1790726400000-add-pending-target-index.js';
import { IndexRequestsBySubmitter1790812800000 } from './1790812800000-index-requests-by-submitter.js';
import { StoreUserIdsAsUuid1790899200000 } from './1790899200000-store-user-ids-as-uuid.js';

// Every migration, in the order it must run. Generate new ones with
// `npm run migration:generate -- src/database/migrations/<Name>` and list the
// generated class here.
export const databaseMigrations: Function[] = [
  CreateSupplierSchema1790467200000,
  CreateSupplierRequests1790640000000,
  AddPendingTargetIndex1790726400000,
  IndexRequestsBySubmitter1790812800000,
  StoreUserIdsAsUuid1790899200000,
];
