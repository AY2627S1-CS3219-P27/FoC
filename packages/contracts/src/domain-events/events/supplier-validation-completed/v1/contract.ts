import { defineEventContract } from '../../../event-contract.types.js';
import schema from './schema.json' with { type: 'json' };

/**
 * Supplier Service's answer to a supplier-validation request: exactly one per
 * request (Supplier FR F15.7.2). It reports facts only; Order Service decides
 * what they mean for the errand (F15.2).
 */
export const SUPPLIER_VALIDATION_COMPLETED_V1_ROUTING_KEY =
  'supplier.validation-completed.v1';

export type SupplierValidationOutcome = 'FOUND' | 'NOT_FOUND';

/** The supplier's current details, enough for a consumer's own copy (F15.1). */
export interface SupplierValidationSnapshot {
  status: 'Active' | 'Inactive';
  version: number;
  name: string;
  displayName: string;
  building: { id: string; shortName: string; canonicalName: string };
  floor: string;
  locationDescription: string;
  coordinates: { latitude: number; longitude: number };
}

export type SupplierValidationCompletedPayload = {
  errandId: string;
  supplierId: string;
} & (
  | { outcome: 'FOUND'; supplier: SupplierValidationSnapshot }
  | { outcome: 'NOT_FOUND' }
);

export const supplierValidationCompletedV1Contract =
  defineEventContract<SupplierValidationCompletedPayload>()({
    routingKey: SUPPLIER_VALIDATION_COMPLETED_V1_ROUTING_KEY,
    eventType: 'SupplierValidationCompleted',
    publisher: 'supplier-service',
    schema,
  });
