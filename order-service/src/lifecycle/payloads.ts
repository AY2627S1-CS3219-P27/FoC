import Joi from 'joi';

// Private event payloads (ADR 0005), one Joi schema per event type. These are
// schema_version 1, the column default; a breaking change adds a version.
// They check the caller's `payload` only: projection columns arrive through
// `set` / `clears` and are checked against the edge. Joi rejects unknown keys,
// so a payload can never carry a projection column name.
const uuid = Joi.string().uuid().required();
const amount = Joi.number().integer().min(1);
const reason = Joi.string().max(100).required(); // credit's rejection reason, already contract-checked
const none = Joi.object({});
// F1.7.2 bounds (create.ts); the edit edges turn this into expiresAt.
const expiryDurationMinutes = Joi.number().integer().min(15).max(168 * 60);

export const PAYLOADS: Record<string, Joi.ObjectSchema> = {
  // Snapshot is already contract-checked on receipt.
  SupplierValidated: Joi.object({ supplierEventId: uuid, supplier: Joi.object().required() }),
  CreditReserved: Joi.object({
    creditEventId: uuid,
    creditTransactionId: uuid,
    reservedAmount: amount.required(),
  }),
  // A credit or supplier rejection carries that service's event; other cancels nothing.
  ErrandCancelled: Joi.object({
    creditEventId: Joi.string().uuid(),
    requestedAmount: amount,
    supplierEventId: Joi.string().uuid(),
    supplierOutcome: Joi.string().valid('NOT_FOUND', 'INACTIVE', 'BUILDING_NOT_FOUND', 'VENUE_NOT_FOUND'),
  })
    .and('creditEventId', 'requestedAmount')
    .and('supplierEventId', 'supplierOutcome')
    .oxor('creditEventId', 'supplierEventId'),
  // F2: pending ids ride in `set`; same supplier snapshot shape as SupplierValidated.
  SupplierRevalidationRequested: Joi.object({ expiryDurationMinutes }),
  SupplierRevalidated: Joi.object({ supplierEventId: uuid, supplier: Joi.object().required() }),
  // TIMEOUT comes from the hold sweep, every other outcome from a supplier reply.
  SupplierRevalidationFailed: Joi.object({
    supplierOutcome: Joi.string()
      .valid('NOT_FOUND', 'INACTIVE', 'BUILDING_NOT_FOUND', 'VENUE_NOT_FOUND', 'TIMEOUT')
      .required(),
    supplierEventId: Joi.string()
      .uuid()
      .when('supplierOutcome', { is: 'TIMEOUT', then: Joi.forbidden(), otherwise: Joi.required() }),
  }),
  ErrandAccepted: none,
  // Edited columns ride in `set`; only the new duration is payload.
  ErrandEdited: Joi.object({ expiryDurationMinutes }),
  AdjustmentRequested: Joi.object({ newAmount: amount.required(), expiryDurationMinutes }),
  CreditAdjusted: Joi.object({ creditEventId: uuid, creditTransactionId: uuid }),
  CreditAdjustmentFailed: Joi.object({
    creditEventId: uuid,
    reason,
    requestedAmount: amount.required(),
  }),
  ErrandPickedUp: none,
  // F7.4 (#325): the courier must say why. Free text, not blank.
  CourierWithdrew: Joi.object({
    reason: Joi.string().pattern(/\S/).max(500).required(),
  }),
  ErrandDelivered: none,
  ErrandConfirmed: none,
  ErrandIncomplete: none,
  CreditTransferSucceeded: Joi.object({
    creditEventId: uuid,
    creditTransactionId: uuid,
    transferredAmount: amount.required(),
  }),
  CreditTransferRejected: Joi.object({ creditEventId: uuid, reason }),
  // The amount and note ride in `set` (projection columns), not the payload.
  SettlementRequested: none,
  CreditSettlementSucceeded: Joi.object({ creditEventId: uuid, creditTransactionId: uuid }),
  CreditSettlementRejected: Joi.object({ creditEventId: uuid, reason }),
};

// An event type without a schema is refused, so a new edge needs one. No
// conversion: the payload is stored as given, so '9' must not pass as 9.
export const payloadValid = (type: string, payload: unknown): boolean => {
  const schema = PAYLOADS[type];
  return !!schema && !schema.validate(payload ?? {}, { convert: false }).error;
};
