import {
  CREDIT_ACCOUNT_INITIALISED_V1_ROUTING_KEY,
  creditAccountInitialisedV1Contract,
} from './events/credit-account-initialised/v1/contract.js';
import {
  USER_REGISTERED_V1_ROUTING_KEY,
  userRegisteredV1Contract,
} from './events/user-registered/v1/contract.js';

/** The authoritative routing-key to event-contract mapping. */
export const eventRegistry = {
  [USER_REGISTERED_V1_ROUTING_KEY]: userRegisteredV1Contract,
  [CREDIT_ACCOUNT_INITIALISED_V1_ROUTING_KEY]:
    creditAccountInitialisedV1Contract,
} as const;
