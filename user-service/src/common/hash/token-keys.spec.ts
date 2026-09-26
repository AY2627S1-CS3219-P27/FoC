import { otpRecordKey, registrationTokenRecordKey } from './token-keys.js';

describe('token-keys', () => {
  it('derives a deterministic OTP record key (16-byte digest)', () => {
    const first = otpRecordKey('eve@example.com', 'Ab3_-x', 'server-secret');
    const second = otpRecordKey('eve@example.com', 'Ab3_-x', 'server-secret');

    expect(first).toBe(second);
    expect(first).toMatch(/^otp:[0-9a-f]{32}$/);
  });

  it('derives a deterministic registration token record key (32-byte digest)', () => {
    const token = 'Ab3_-x9Qrstuvwxyz1234567890-_ABCD';
    const first = registrationTokenRecordKey(token, 'server-secret');
    const second = registrationTokenRecordKey(token, 'server-secret');

    expect(first).toBe(second);
    expect(first).toMatch(/^regtoken:[0-9a-f]{64}$/);
  });

  it('differs when the server secret differs', () => {
    expect(
      otpRecordKey('eve@example.com', 'Ab3_-x', 'secret-a'),
    ).not.toBe(otpRecordKey('eve@example.com', 'Ab3_-x', 'secret-b'));
    expect(
      registrationTokenRecordKey('Ab3_-x9Qrst', 'secret-a'),
    ).not.toBe(registrationTokenRecordKey('Ab3_-x9Qrst', 'secret-b'));
  });
});