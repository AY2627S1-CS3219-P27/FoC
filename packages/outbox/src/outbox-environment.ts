import Joi from 'joi';

/** Environment knobs the shared outbox relay reads at runtime. */
export interface OutboxEnvironmentVariables {
  OUTBOX_POLL_INTERVAL_MS: number;
  OUTBOX_BATCH_SIZE: number;
  OUTBOX_CONFIRM_TIMEOUT_MS: number;
  OUTBOX_CLAIM_LEASE_MS: number;
  OUTBOX_RETRY_BASE_DELAY_MS: number;
  OUTBOX_RETRY_MAX_DELAY_MS: number;
  OUTBOX_UNPUBLISHED_WARNING_MS: number;
}

const MIN_OUTBOX_COMPLETION_MARGIN_MS = 5_000;

/**
 * Key definitions a consuming service spreads into its own environment schema
 * so every service validates and defaults the outbox knobs identically.
 */
export const outboxEnvironmentKeys = {
  OUTBOX_POLL_INTERVAL_MS: Joi.number().integer().min(1).default(1_000),
  OUTBOX_BATCH_SIZE: Joi.number().integer().min(1).default(100),
  OUTBOX_CONFIRM_TIMEOUT_MS: Joi.number().integer().min(1).default(20_000),
  OUTBOX_CLAIM_LEASE_MS: Joi.number().integer().min(1).default(30_000),
  OUTBOX_RETRY_BASE_DELAY_MS: Joi.number()
    .integer()
    .min(1)
    .max(Number.MAX_SAFE_INTEGER)
    .default(1_000),
  OUTBOX_RETRY_MAX_DELAY_MS: Joi.number()
    .integer()
    .min(1)
    .max(Number.MAX_SAFE_INTEGER)
    .default(60_000),
  OUTBOX_UNPUBLISHED_WARNING_MS: Joi.number().integer().min(1).default(60_000),
};

export const outboxEnvironmentSchema = Joi.object<OutboxEnvironmentVariables>(
  outboxEnvironmentKeys,
);

/**
 * Cross-field check to attach to the service's full environment schema via
 * `.custom(...)`: the claim lease must outlive the publisher-confirm timeout
 * by a safety margin, and the retry delay range must be sane.
 */
export function validateOutboxTiming<T extends OutboxEnvironmentVariables>(
  environment: T,
  helpers: Joi.CustomHelpers,
): T {
  const completionMargin =
    environment.OUTBOX_CLAIM_LEASE_MS - environment.OUTBOX_CONFIRM_TIMEOUT_MS;
  if (completionMargin < MIN_OUTBOX_COMPLETION_MARGIN_MS) {
    return helpers.error('any.invalid') as never;
  }
  if (
    environment.OUTBOX_RETRY_MAX_DELAY_MS <
    environment.OUTBOX_RETRY_BASE_DELAY_MS
  ) {
    return helpers.error('any.invalid') as never;
  }
  return environment;
}
