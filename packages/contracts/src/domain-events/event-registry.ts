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
} as const;
