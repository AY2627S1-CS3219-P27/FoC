import Joi from 'joi';

const DEFAULT_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000];

// "1000,2000,..." -> five strictly increasing positive delays (the transport has five retry queues).
const retryDelaysSchema = Joi.any()
  .default(DEFAULT_RETRY_DELAYS_MS)
  .custom((value: unknown, helpers) => {
    if (typeof value !== 'string') {
      return helpers.error('any.invalid');
    }
    const delays = value.split(',').map((delay) => Number(delay.trim()));
    if (
      delays.length !== 5 ||
      delays.some((delay) => !Number.isSafeInteger(delay) || delay <= 0) ||
      delays.some((delay, index) => index > 0 && delay <= delays[index - 1])
    ) {
      return helpers.error('any.invalid');
    }
    return delays;
  }, 'RabbitMQ retry delays');

const DEFAULT_TRACKING_BBOX = [103.62, 1.22, 104.03, 1.47];

// "minLon,minLat,maxLon,maxLat" -> [number x4], min < max on both axes.
const bboxSchema = Joi.any()
  .default(DEFAULT_TRACKING_BBOX)
  .custom((value: unknown, helpers) => {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string') return helpers.error('any.invalid');
    const parts = value.split(',').map((p) => p.trim());
    const n = parts.map((p) => (p === '' ? NaN : Number(p)));
    if (n.length !== 4 || n.some((x) => !Number.isFinite(x))) return helpers.error('any.invalid');
    const [minLon, minLat, maxLon, maxLat] = n;
    if (minLon >= maxLon || minLat >= maxLat) return helpers.error('any.invalid');
    if (Math.abs(minLat) > 90 || Math.abs(maxLat) > 90 || Math.abs(minLon) > 180 || Math.abs(maxLon) > 180) {
      return helpers.error('any.invalid');
    }
    return n;
  }, 'tracking bounding box');

export const environmentSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  LOG_LEVEL: Joi.string()
    .valid('debug', 'info', 'warn', 'error', 'fatal')
    .default('info'),
  OTEL_EXPORTER_OTLP_ENDPOINT: Joi.string().uri().default('http://localhost:4318'),

  DB_HOST: Joi.string().hostname().required(),
  DB_PORT: Joi.number().port().required(),
  DB_USERNAME: Joi.string().min(1).required(),
  DB_DATABASE: Joi.string().min(1).required(),
  DB_PASSWORD_FILE: Joi.string().min(1).required(),
  DB_MIGRATIONS_RUN: Joi.boolean().default(true),

  // user-service's RS256 public key (PEM), used by @foc/auth to verify access tokens.
  JWT_PUBLIC_KEY_FILE: Joi.string().min(1).required(),

  RABBITMQ_USER: Joi.string().min(1).required(),
  RABBITMQ_HOST: Joi.string().hostname().required(),
  RABBITMQ_PORT: Joi.number().port().required(),
  RABBITMQ_VHOST: Joi.string().min(1).required(),
  RABBITMQ_PASSWORD_FILE: Joi.string().min(1).required(),
  RABBITMQ_EXCHANGE: Joi.string().min(1).default('foc.events'),
  RABBITMQ_RETRY_EXCHANGE: Joi.string().min(1).default('foc.order.retry'),
  RABBITMQ_RETRY_RETURN_EXCHANGE: Joi.string().min(1).default('foc.order.back'),
  RABBITMQ_DEAD_LETTER_EXCHANGE: Joi.string().min(1).default('foc.order.dlx'),
  RABBITMQ_PREFETCH: Joi.number().integer().min(1).default(10),
  RABBITMQ_RETRY_DELAYS_MS: retryDelaysSchema,

  OUTBOX_POLL_INTERVAL_MS: Joi.number().integer().min(1).default(1_000),
  OUTBOX_BATCH_SIZE: Joi.number().integer().min(1).default(100),
  OUTBOX_CONFIRM_TIMEOUT_MS: Joi.number().integer().min(1).default(20_000),
  OUTBOX_CLAIM_LEASE_MS: Joi.number().integer().min(1).default(30_000),
  OUTBOX_RETRY_BASE_DELAY_MS: Joi.number().integer().min(1).default(1_000),
  OUTBOX_RETRY_MAX_DELAY_MS: Joi.number().integer().min(1).default(60_000),
  OUTBOX_UNPUBLISHED_WARNING_MS: Joi.number().integer().min(1).default(60_000),

  SWEEP_INTERVAL_MS: Joi.number().integer().min(1).default(60_000),
  RESERVING_CREDIT_TIMEOUT_MS: Joi.number().integer().min(1).default(300_000),
  CREDIT_REPLY_TIMEOUT_MS: Joi.number().integer().min(1).default(120_000),
  CREDIT_RESEND_MAX: Joi.number().integer().min(0).default(3),
  IDEMPOTENCY_KEY_TTL_MS: Joi.number().integer().min(1).default(604_800_000), // 7 days
  // Must be at least user-service's access-token lifetime (15 min) plus skew; not checkable across services.
  ROLE_BLOCK_TTL_MS: Joi.number().integer().min(1).default(960_000),
  SUPPLIER_RETRY_BASE_MS: Joi.number().integer().min(1).default(1_000),
  SUPPLIER_RETRY_MAX_MS: Joi.number().integer().min(Joi.ref('SUPPLIER_RETRY_BASE_MS')).default(300_000), // 5 min
  SUPPLIER_VALIDATION_HOLD_MS: Joi.number().integer().min(1).default(1_800_000), // 30 min

  // Live courier tracking (Redis only; nothing is persisted in Postgres).
  REDIS_HOST: Joi.string().hostname().required(),
  REDIS_PORT: Joi.number().port().required(),
  REDIS_USERNAME: Joi.string().min(1).required(),
  REDIS_DB_INDEX: Joi.number().integer().min(0).default(1),
  TRACKING_LOCATION_TTL_S: Joi.number().integer().min(1).default(120),
  TRACKING_MIN_UPDATE_INTERVAL_MS: Joi.number().integer().min(0).default(1_000),
  TRACKING_SSE_KEEPALIVE_MS: Joi.number().integer().min(1).default(20_000),
  TRACKING_BBOX: bboxSchema,
  TRACKING_ROUTE_TTL_S: Joi.number().integer().min(1).default(600),
  TRACKING_REROUTE_DISTANCE_M: Joi.number().min(0).default(50),
  OSRM_BASE_URL: Joi.string().uri().default('http://osrm:5000'),
  OSRM_TIMEOUT_MS: Joi.number().integer().min(1).default(3_000),
  TRACKING_MAX_STREAMS_PER_ERRAND: Joi.number().integer().min(1).default(5),
  TRACKING_MAX_STREAMS_PER_USER: Joi.number().integer().min(1).default(10),
})
  // The lease must outlast the confirm timeout, or a slow publish loses its claim.
  .custom((env, helpers) => {
    if (
      env.OUTBOX_CLAIM_LEASE_MS - env.OUTBOX_CONFIRM_TIMEOUT_MS < 5_000 ||
      env.OUTBOX_RETRY_MAX_DELAY_MS < env.OUTBOX_RETRY_BASE_DELAY_MS
    ) {
      return helpers.error('any.invalid');
    }
    return env;
  }, 'outbox timing relationships')
  .unknown(true)
  .prefs({ abortEarly: false, convert: true });
