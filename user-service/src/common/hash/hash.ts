import { argon2, createHmac } from 'crypto';

export async function hashValue(value: string, salt: string): Promise<string>;
export async function hashValue(
  value: string,
  salt: string,
  bytes: number,
): Promise<string>;
export async function hashValue(
  value: string,
  salt: string,
  bytes?: number,
): Promise<string> {
  let hashBytes: number = 64;

  if (bytes !== undefined) {
    hashBytes = bytes;
  }

  const parameters = {
    message: value,
    nonce: salt,
    parallelism: 2,
    tagLength: hashBytes,
    memory: 19456,
    passes: 2,
  };

  return new Promise((resolve, reject) => {
    argon2('argon2id', parameters, (err, derivedKey) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(derivedKey.toString('hex'));
    });
  });
}

/**
 * Keyed digest (HMAC-SHA256) for high-entropy tokens stored hashed purely to
 * avoid plaintext at rest: OTPs and registration tokens.
 *
 * We slice it to a (bytes)-long sequence of hex values. This is still
 * cryptographically safe, as the algorithm distributes entropy evently.
 */
export function hmacValue(value: string, key: string, bytes = 32): string {
  return createHmac('sha256', key)
    .update(value, 'utf8')
    .digest()
    .subarray(0, bytes)
    .toString('hex');
}
