import { environmentSchema, logLevelsUpTo } from './environment.schema.js';

const REQUIRED = {
  DB_HOST: 'rag-db',
  DB_PORT: '5432',
  DB_USERNAME: 'rag_service',
  DB_DATABASE: 'rag_service',
  DB_PASSWORD_FILE: '/run/secrets/rag_db_password',
  JWT_PUBLIC_KEY_FILE: '/run/secrets/rag_jwt_public_key',
  OPENROUTER_API_KEY_FILE: '/run/secrets/rag_openrouter_api_key',
};

describe('environmentSchema', () => {
  it('accepts the minimal environment and applies defaults', () => {
    const { value, error } = environmentSchema.validate(REQUIRED);

    expect(error).toBeUndefined();
    expect(value).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      LOG_LEVEL: 'log',
      DB_PORT: 5432,
      DB_MIGRATIONS_RUN: true,
      OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
      OPENROUTER_CHAT_MODEL: 'anthropic/claude-haiku-5.5',
      OPENROUTER_EMBEDDING_MODEL: 'openai/text-embedding-3-small',
      SUPPORT_DOCS_PATH: '/support-docs',
    });
  });

  it('reports every missing required setting together', () => {
    const { error } = environmentSchema.validate({});

    const missing = error?.details.map((detail) => detail.path[0]);
    expect(missing).toEqual(Object.keys(REQUIRED));
  });

  it('rejects an unknown log level', () => {
    const { error } = environmentSchema.validate({
      ...REQUIRED,
      LOG_LEVEL: 'loud',
    });

    expect(error?.details[0].path).toEqual(['LOG_LEVEL']);
  });

  it('rejects an OpenRouter address that is not a web URL', () => {
    const { error } = environmentSchema.validate({
      ...REQUIRED,
      OPENROUTER_BASE_URL: 'ftp://openrouter.ai',
    });

    expect(error?.details[0].path).toEqual(['OPENROUTER_BASE_URL']);
  });
});

describe('logLevelsUpTo', () => {
  it('includes every level more severe than the chosen one', () => {
    expect(logLevelsUpTo('warn')).toEqual(['fatal', 'error', 'warn']);
  });
});
