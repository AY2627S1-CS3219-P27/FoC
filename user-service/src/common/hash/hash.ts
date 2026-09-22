import { argon2 } from 'crypto';

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
