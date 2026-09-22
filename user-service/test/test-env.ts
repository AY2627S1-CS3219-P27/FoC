// Seeds minimal, valid placeholder values for every env var required by
// src/config/environment.schema.ts. ConfigModule.forRoot validates the
// environment while AppModule compiles — before any provider overrides apply —
// so e2e specs that boot the full AppModule must have these set regardless of
// what infra they later override. Process env takes precedence over the local
// .env file in @nestjs/config, so this is hermetic even on machines whose
// .env is absent.
export function seedTestEnvironment(): void {
  process.env.DB_HOST = 'localhost';
  process.env.DB_PORT = '5432';
  process.env.DB_USERNAME = 'test';
  process.env.DB_DATABASE = 'test';
  process.env.DB_PASSWORD_FILE = '/run/secrets/db_password';
  process.env.REDIS_HOST = 'localhost';
  process.env.REDIS_PORT = '6379';
  process.env.REDIS_USERNAME = 'default';
  process.env.REDIS_DB_INDEX = '0';
  process.env.SERVER_SECRET_FILE = '/run/secrets/server_secret';
  process.env.EMAIL_SERVICE_ENDPOINT = 'http://email-service:3000/email';
}