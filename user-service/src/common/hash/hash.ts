import { argon2, randomBytes } from 'crypto';

export async function hashValue(value: string): Promise<string>;
export async function hashValue(value: string, bytes: number): Promise<string>;
export async function hashValue(
  value: string,
  salt: string,
  bytes?: number,
): Promise<string>;
export async function hashValue(
  value: string,
  bytesOrSalt?: number | string,
  bytes?: number,
): Promise<string> {
  let salt: string;
  let hashBytes: number;

  if (typeof bytesOrSalt === 'string') {
    salt = bytesOrSalt;
    hashBytes = bytes ?? 64;
  } else {
    salt = randomBytes(16).toString('hex');
    hashBytes = bytesOrSalt ?? 64;
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
