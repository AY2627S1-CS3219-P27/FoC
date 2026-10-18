import {
  CREDIT_ACCOUNT_INITIALISED_V1_ROUTING_KEY,
  creditAccountInitialisedV1Contract,
} from './events/credit-account-initialised/v1/contract.js';
import {
  CREDIT_RESERVATION_ADJUSTMENT_REJECTED_V1_ROUTING_KEY,
  creditReservationAdjustmentRejectedV1Contract,
} from './events/credit-reservation-adjustment-rejected/v1/contract.js';
import {
  CREDIT_RESERVATION_ADJUSTMENT_SUCCESS_V1_ROUTING_KEY,
  creditReservationAdjustmentSuccessV1Contract,
} from './events/credit-reservation-adjustment-success/v1/contract.js';
import {
  CREDIT_RESERVATION_ADJUSTMENT_V1_ROUTING_KEY,
  creditReservationAdjustmentV1Contract,
} from './events/credit-reservation-adjustment/v1/contract.js';
import {
  CREDIT_RESERVATION_REJECTED_V1_ROUTING_KEY,
  creditReservationRejectedV1Contract,
} from './events/credit-reservation-rejected/v1/contract.js';
import {
  CREDIT_RESERVATION_SUCCESS_V1_ROUTING_KEY,
  creditReservationSuccessV1Contract,
} from './events/credit-reservation-success/v1/contract.js';
import {
  CREDIT_RESERVATION_V1_ROUTING_KEY,
  creditReservationV1Contract,
} from './events/credit-reservation/v1/contract.js';
import {
  ORDER_ERRAND_COMPLETED_V1_ROUTING_KEY,
  errandCompletedV1Contract,
} from './events/errand-completed/v1/contract.js';
import {
  ORDER_ERRAND_CANCELLED_V1_ROUTING_KEY,
  errandCancelledV1Contract,
} from './events/errand-cancelled/v1/contract.js';
import {
  CREDIT_TRANSFER_SUCCEEDED_V1_ROUTING_KEY,
  creditTransferSucceededV1Contract,
} from './events/credit-transfer-succeeded/v1/contract.js';
import {
  CREDIT_TRANSFER_REJECTED_V1_ROUTING_KEY,
  creditTransferRejectedV1Contract,
} from './events/credit-transfer-rejected/v1/contract.js';
import {
  CREDIT_RELEASE_REJECTED_V1_ROUTING_KEY,
  creditReleaseRejectedV1Contract,
} from './events/credit-release-rejected/v1/contract.js';
import {
  CREDIT_RELEASE_SUCCESS_V1_ROUTING_KEY,
  creditReleaseSuccessV1Contract,
} from './events/credit-release-success/v1/contract.js';
import {
  ORDER_SUPPLIER_VALIDATION_REQUESTED_V1_ROUTING_KEY,
  supplierValidationRequestedV1Contract,
} from './events/supplier-validation-requested/v1/contract.js';
import {
  SUPPLIER_VALIDATION_COMPLETED_V1_ROUTING_KEY,
  supplierValidationCompletedV1Contract,
} from './events/supplier-validation-completed/v1/contract.js';
import {
  USER_REGISTERED_V1_ROUTING_KEY,
  userRegisteredV1Contract,
} from './events/user-registered/v1/contract.js';

/** The authoritative routing-key to event-contract mapping. */
export const eventRegistry = {
  [USER_REGISTERED_V1_ROUTING_KEY]: userRegisteredV1Contract,
  [CREDIT_ACCOUNT_INITIALISED_V1_ROUTING_KEY]:
    creditAccountInitialisedV1Contract,
  [CREDIT_RESERVATION_V1_ROUTING_KEY]: creditReservationV1Contract,
  [CREDIT_RESERVATION_ADJUSTMENT_V1_ROUTING_KEY]:
    creditReservationAdjustmentV1Contract,
  [CREDIT_RESERVATION_SUCCESS_V1_ROUTING_KEY]:
    creditReservationSuccessV1Contract,
  [CREDIT_RESERVATION_REJECTED_V1_ROUTING_KEY]:
    creditReservationRejectedV1Contract,
  [CREDIT_RESERVATION_ADJUSTMENT_SUCCESS_V1_ROUTING_KEY]:
    creditReservationAdjustmentSuccessV1Contract,
  [CREDIT_RESERVATION_ADJUSTMENT_REJECTED_V1_ROUTING_KEY]:
    creditReservationAdjustmentRejectedV1Contract,
  [ORDER_ERRAND_COMPLETED_V1_ROUTING_KEY]: errandCompletedV1Contract,
  [ORDER_ERRAND_CANCELLED_V1_ROUTING_KEY]: errandCancelledV1Contract,
  [CREDIT_TRANSFER_SUCCEEDED_V1_ROUTING_KEY]: creditTransferSucceededV1Contract,
  [CREDIT_TRANSFER_REJECTED_V1_ROUTING_KEY]: creditTransferRejectedV1Contract,
  [CREDIT_RELEASE_SUCCESS_V1_ROUTING_KEY]: creditReleaseSuccessV1Contract,
  [CREDIT_RELEASE_REJECTED_V1_ROUTING_KEY]: creditReleaseRejectedV1Contract,
  [ORDER_SUPPLIER_VALIDATION_REQUESTED_V1_ROUTING_KEY]:
    supplierValidationRequestedV1Contract,
  [SUPPLIER_VALIDATION_COMPLETED_V1_ROUTING_KEY]:
    supplierValidationCompletedV1Contract,
} as const;
