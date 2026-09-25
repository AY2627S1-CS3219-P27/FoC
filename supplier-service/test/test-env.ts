import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Seeds minimal, valid placeholder values for every env var required by
// src/config/environment.schema.ts. ConfigModule.forRoot validates the
// environment while AppModule compiles — before any provider overrides apply —
// so e2e specs that boot the full AppModule must have these set regardless of
// what infra they later override. Process env takes precedence over the local
// .env file in @nestjs/config, so this is hermetic even on machines whose
// .env is absent.
export function seedTestEnvironment(): void {
  // The TypeORM options factory reads the password file even when the
  // DataSource itself is stubbed, so point it at a real throwaway file.
  const secretDir = mkdtempSync(join(tmpdir(), 'supplier-e2e-'));
  const passwordFile = join(secretDir, 'supplier_db_password');
  writeFileSync(passwordFile, 'test-db-password\n');

  process.env.NODE_ENV = 'test';
  process.env.DB_HOST = 'localhost';
  process.env.DB_PORT = '5439';
  process.env.DB_USERNAME = 'supplier_service';
  process.env.DB_DATABASE = 'supplier_service_test';
  process.env.DB_PASSWORD_FILE = passwordFile;
  process.env.DB_MIGRATIONS_RUN = 'false';
}
