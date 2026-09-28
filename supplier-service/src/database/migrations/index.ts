import { CreateSupplierSchema1790467200000 } from './1790467200000-create-supplier-schema.js';

// Every migration, in the order it must run. Generate new ones with
// `npm run migration:generate -- src/database/migrations/<Name>` and list the
// generated class here.
export const databaseMigrations: Function[] = [
  CreateSupplierSchema1790467200000,
];
