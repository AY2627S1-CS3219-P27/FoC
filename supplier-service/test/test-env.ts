import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface TestEnvironment {
  /** Signs test access tokens that the app accepts (its public key is set). */
  privateKey: string;
}

// Seeds minimal, valid placeholder values for every env var required by
// src/config/environment.schema.ts. ConfigModule.forRoot validates the
// environment while AppModule compiles — before any provider overrides apply —
// so e2e specs that boot the full AppModule must have these set regardless of
// what infra they later override. Process env takes precedence over the local
// .env file in @nestjs/config, so this is hermetic even on machines whose
// .env is absent.
export function seedTestEnvironment(): TestEnvironment {
  // The TypeORM options factory reads the password file even when the
  // DataSource itself is stubbed, so point it at a real throwaway file.
  const secretDir = mkdtempSync(join(tmpdir(), 'supplier-e2e-'));
  const passwordFile = join(secretDir, 'supplier_db_password');
  writeFileSync(passwordFile, 'test-db-password\n');

  // A real key pair, as in user-service's e2e: the app verifies with the
  // public key and the tests sign with the private key.
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const publicKeyFile = join(secretDir, 'jwt_public_key');
  writeFileSync(publicKeyFile, publicKey);

  process.env.NODE_ENV = 'test';
  process.env.DB_HOST = 'localhost';
  process.env.DB_PORT = '5439';
  process.env.DB_USERNAME = 'supplier_service';
  process.env.DB_DATABASE = 'supplier_service_test';
  process.env.DB_PASSWORD_FILE = passwordFile;
  process.env.DB_MIGRATIONS_RUN = 'false';
  // The database is stubbed in e2e specs, so there is nothing to seed into.
  process.env.SEED_ON_STARTUP = 'false';
  process.env.JWT_PUBLIC_KEY_FILE = publicKeyFile;

  return { privateKey };
}
