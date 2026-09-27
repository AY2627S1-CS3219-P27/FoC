import { generateKeyPairSync } from 'node:crypto';

export interface RsaKeyPair {
  privateKeyPem: string;
  publicKeyPem: string;
}

/**
 * Generates a fresh RSA keypair for test fixtures. Verification uses RS256,
 * so specs sign with the private key and verify with the public key, exactly
 * as user-service and the consuming services do at runtime.
 */
export function generateRsaKeyPair(): RsaKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { privateKeyPem: privateKey, publicKeyPem: publicKey };
}
