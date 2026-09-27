import Joi from 'joi';

import type { AccessTokenPayload } from './access-token-payload.js';
import type { ContractValidationResult } from '../common/types.js';
import { Role } from '../user-roles/role.js';
import { joiErrorsToViolations } from '../common/violation-convertors.js';

/** The fixed issuer every user-service token is created with. */
export const ACCESS_TOKEN_ISSUER = 'user-service';

/** The name of the cookie carrying the access token. */
export const ACCESS_TOKEN_COOKIE = 'access_token';

/**
 * The Joi schema of the access-token claims. This is the contract
 * of the token's shape. Unknown claims are rejected outright.
 */
const accessTokenPayloadSchema = Joi.object<AccessTokenPayload>({
  sub: Joi.number().integer().required(),
  email: Joi.string().email().required(),
  displayName: Joi.string().min(1).required(),
  isAdmin: Joi.boolean().required(),
  roles: Joi.array()
    .items(Joi.string().valid(...Object.values(Role)))
    .unique()
    .required(),
  iss: Joi.string().valid(ACCESS_TOKEN_ISSUER).required(),
  iat: Joi.number().required(),
  exp: Joi.number().required(),
}).required(); // reject a top-level undefined, as the contract always demands claims

/**
 * Strictly validates decoded access-token claims without coercing, defaulting,
 * or removing fields.
 */
export function validateAccessTokenPayload(
  input: unknown,
): ContractValidationResult<AccessTokenPayload> {
  const { value, error } = accessTokenPayloadSchema.validate(input, {
    convert: false,
    abortEarly: false,
  });

  if (error) {
    return {
      valid: false,
      code: 'INVALID_TOKEN_PAYLOAD',
      violations: joiErrorsToViolations(error),
    };
  }

  return { valid: true, value };
}
