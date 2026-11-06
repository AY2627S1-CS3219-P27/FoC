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
// environment while AppModule compiles, before any provider overrides apply,
// so e2e specs that boot the full AppModule must have these set regardless of
// what infra they later override.
export function seedTestEnvironment(): TestEnvironment {
  // The TypeORM options factory reads the password file even when the
  // DataSource itself is stubbed, so point it at a real throwaway file.
  const secretDir = mkdtempSync(join(tmpdir(), 'rag-e2e-'));
  const passwordFile = join(secretDir, 'rag_db_password');
  writeFileSync(passwordFile, 'test-db-password\n');

  // A real key pair: the app verifies with the public key and the tests sign
  // with the private key.
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const publicKeyFile = join(secretDir, 'jwt_public_key');
  writeFileSync(publicKeyFile, publicKey);
  const openRouterKeyFile = join(secretDir, 'openrouter_api_key');
  writeFileSync(openRouterKeyFile, 'test-openrouter-key\n');

  process.env.NODE_ENV = 'test';
  process.env.DB_HOST = 'localhost';
  process.env.DB_PORT = '5443';
  process.env.DB_USERNAME = 'rag_service';
  process.env.DB_DATABASE = 'rag_service_test';
  process.env.DB_PASSWORD_FILE = passwordFile;
  process.env.DB_MIGRATIONS_RUN = 'false';
  process.env.JWT_PUBLIC_KEY_FILE = publicKeyFile;
  process.env.OPENROUTER_API_KEY_FILE = openRouterKeyFile;

  return { privateKey };
}
