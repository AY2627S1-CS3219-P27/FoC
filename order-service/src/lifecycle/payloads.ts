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

export const PAYLOADS: Record<string, Joi.ObjectSchema> = {
  SupplierValidated: none,
  CreditReserved: Joi.object({
    creditEventId: uuid,
    creditTransactionId: uuid,
    reservedAmount: amount.required(),
  }),
  // A credit rejection carries credit's event; a requester or sweep cancel nothing.
  ErrandCancelled: Joi.object({
    creditEventId: Joi.string().uuid(),
    requestedAmount: amount,
  }).and('creditEventId', 'requestedAmount'),
  ErrandAccepted: none,
  AdjustmentRequested: Joi.object({ newAmount: amount.required() }),
  CreditAdjusted: Joi.object({ creditEventId: uuid, creditTransactionId: uuid }),
  CreditAdjustmentFailed: Joi.object({
    creditEventId: uuid,
    reason,
    requestedAmount: amount.required(),
  }),
  ErrandPickedUp: none,
  CourierWithdrew: none,
  ErrandDelivered: none,
  ErrandConfirmed: none,
  ErrandIncomplete: none,
  ErrandCompleted: Joi.object({
    creditEventId: uuid,
    creditTransactionId: uuid,
    transferredAmount: amount.required(),
  }),
  CreditTransferFailed: Joi.object({ creditEventId: uuid, reason }),
};

// An event type without a schema is refused, so a new edge needs one. No
// conversion: the payload is stored as given, so '9' must not pass as 9.
export const payloadValid = (type: string, payload: unknown): boolean => {
  const schema = PAYLOADS[type];
  return !!schema && !schema.validate(payload ?? {}, { convert: false }).error;
};
