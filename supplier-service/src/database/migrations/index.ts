import { CreateSupplierSchema1790467200000 } from './1790467200000-create-supplier-schema.js';
import { CreateSupplierRequests1790640000000 } from './1790640000000-create-supplier-requests.js';

// Every migration, in the order it must run. Generate new ones with
// `npm run migration:generate -- src/database/migrations/<Name>` and list the
// generated class here.
export const databaseMigrations: Function[] = [
  CreateSupplierSchema1790467200000,
  CreateSupplierRequests1790640000000,
];
