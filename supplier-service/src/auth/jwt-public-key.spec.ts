import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readJwtPublicKey } from './jwt-public-key.js';

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

describe('readJwtPublicKey', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'supplier-jwt-key-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function file(content: string): string {
    const path = join(dir, 'jwt_public_key.secret');
    writeFileSync(path, content);
    return path;
  }

  it('returns the PEM public key without surrounding whitespace', () => {
    expect(readJwtPublicKey(file(`${publicKey}\n`))).toBe(publicKey.trim());
  });

  it('refuses a private key mounted by mistake', () => {
    expect(() => readJwtPublicKey(file(privateKey))).toThrow('private key');
  });

  it('refuses an empty or non-PEM file', () => {
    expect(() => readJwtPublicKey(file('\n'))).toThrow('PEM public key');
    expect(() => readJwtPublicKey(file('replace-me'))).toThrow(
      'PEM public key',
    );
  });
});
