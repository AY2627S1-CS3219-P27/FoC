import { defineEventContract } from '../../../event-contract.types.js';
import schema from './schema.json' with { type: 'json' };

/**
 * Supplier Service's answer to a supplier-validation request: exactly one per
 * request (Supplier FR F15.7.2). It reports facts only; Order Service decides
 * what they mean for the errand (F15.2).
 */
export const SUPPLIER_VALIDATION_COMPLETED_V1_ROUTING_KEY =
  'supplier.validation-completed.v1';

/**
 * NOT_FOUND: the supplier does not exist (it wins when the building is unknown
 * too). BUILDING_NOT_FOUND: the supplier exists but the delivery building does not.
 */
export type SupplierValidationOutcome =
  | 'FOUND'
  | 'NOT_FOUND'
  | 'BUILDING_NOT_FOUND';

export interface DeliveryBuildingSnapshot {
  id: string;
  shortName: string;
  canonicalName: string;
}

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
  | {
      outcome: 'FOUND';
      supplier: SupplierValidationSnapshot;
      deliveryBuilding: DeliveryBuildingSnapshot;
    }
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'BUILDING_NOT_FOUND' }
);

export const supplierValidationCompletedV1Contract =
  defineEventContract<SupplierValidationCompletedPayload>()({
    routingKey: SUPPLIER_VALIDATION_COMPLETED_V1_ROUTING_KEY,
    eventType: 'SupplierValidationCompleted',
    publisher: 'supplier-service',
    schema,
  });
