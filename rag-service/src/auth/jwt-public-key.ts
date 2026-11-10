import { readFileSync } from 'node:fs';

/**
 * Reads user-service's JWT public key (PEM) from its Docker secret file.
 * Fails fast at startup on an empty file, a non-PEM file, or a private key
 * mounted by mistake: the private key must never leave user-service.
 */
export function readJwtPublicKey(path: string): string {
  const key = readFileSync(path, 'utf8').trim();

  if (key.includes('PRIVATE KEY')) {
    throw new Error(
      'JWT_PUBLIC_KEY_FILE holds a private key; mount only user-service’s public key',
    );
  }
  if (!/^-----BEGIN (RSA )?PUBLIC KEY-----/.test(key)) {
    throw new Error('JWT_PUBLIC_KEY_FILE must contain a PEM public key');
  }
  return key;
}
