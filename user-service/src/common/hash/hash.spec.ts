import { hashPassword, verifyPassword } from './hash.js';

describe('hash', () => {
  it('produces a self-contained token that verifies', async () => {
    const token = await hashPassword('hunter2');

    expect(token.startsWith('$argon2id$')).toBe(true);
    await expect(verifyPassword('hunter2', token)).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const token = await hashPassword('hunter2');

    await expect(verifyPassword('hunter2!', token)).resolves.toBe(false);
  });

  it('uses a fresh salt on every hash', async () => {
    const first = await hashPassword('hunter2');
    const second = await hashPassword('hunter2');

    expect(first).not.toBe(second);
  });
});