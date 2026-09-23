import { hashValue, hmacValue } from './hash.js';

describe('hash', () => {
  it('produces a deterministic hex digest for the same value and salt', async () => {
    const first = await hashValue('hunter2', 'fixed-salt');
    const second = await hashValue('hunter2', 'fixed-salt');

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{128}$/); // 64-byte digest by default
  });

  it('digests differ when the salt differs', async () => {
    // Salts must be at least 8 bytes long, otherwise argon2 rejects them.
    const withSaltA = await hashValue('hunter2', 'salt-aaaaaaaa');
    const withSaltB = await hashValue('hunter2', 'salt-bbbbbbbb');

    expect(withSaltA).not.toBe(withSaltB);
  });

  it('sizes the digest to the requested number of bytes', async () => {
    const digest16 = await hashValue('hunter2', 'salt-long-enough', 16);
    const digest32 = await hashValue('hunter2', 'salt-long-enough', 32);

    expect(digest16).toMatch(/^[0-9a-f]{32}$/);
    expect(digest32).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('hmacValue', () => {
  it('produces a deterministic hex digest for the same value and key', () => {
    const first = hmacValue('otp-value', 'server-secret', 16);
    const second = hmacValue('otp-value', 'server-secret', 16);

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{32}$/); // 16-byte digest
  });

  it('digests differ when the key differs', () => {
    expect(hmacValue('otp-value', 'secret-a', 16)).not.toBe(
      hmacValue('otp-value', 'secret-b', 16),
    );
  });

  it('sizes the digest to the requested number of bytes', () => {
    expect(hmacValue('otp-value', 'server-secret', 16)).toMatch(
      /^[0-9a-f]{32}$/,
    );
    expect(hmacValue('otp-value', 'server-secret', 32)).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });

  it('defaults to a full 32-byte digest', () => {
    expect(hmacValue('otp-value', 'server-secret')).toMatch(/^[0-9a-f]{64}$/);
  });
});
