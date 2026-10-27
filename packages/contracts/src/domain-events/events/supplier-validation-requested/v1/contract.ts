import { defineEventContract } from '../../../event-contract.types.js';
import schema from './schema.json' with { type: 'json' };

/**
 * Order Service asks Supplier Service whether the supplier chosen for an
 * errand exists, while the errand is Pending-Supplier (Supplier FR F15.7).
 */
export const ORDER_SUPPLIER_VALIDATION_REQUESTED_V1_ROUTING_KEY =
  'order.supplier-validation-requested.v1';

export interface SupplierValidationRequestedPayload {
  errandId: string;
  supplierId: string;
  /** Supplier Service checks it exists; the delivery detail never leaves Order Service. */
  deliveryBuildingId: string;
}

export const supplierValidationRequestedV1Contract =
  defineEventContract<SupplierValidationRequestedPayload>()({
    routingKey: ORDER_SUPPLIER_VALIDATION_REQUESTED_V1_ROUTING_KEY,
    eventType: 'SupplierValidationRequested',
    publisher: 'order-service',
    schema,
  });
