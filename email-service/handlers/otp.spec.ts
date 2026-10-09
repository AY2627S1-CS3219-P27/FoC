import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sendMailMock, isDuplicateMock, forgetMessageIdMock } = vi.hoisted(
  () => {
    const sendMailMock = vi.fn();
    const isDuplicateMock = vi.fn();
    const forgetMessageIdMock = vi.fn();
    return { sendMailMock, isDuplicateMock, forgetMessageIdMock };
  },
);

vi.mock('../utils/mailer.ts', () => ({ sendEmail: sendMailMock }));
vi.mock('./common/dedup.ts', () => ({
  isDuplicate: isDuplicateMock,
  forgetMessageId: forgetMessageIdMock,
}));
vi.mock('../utils/logger.ts', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { processOtpEmailMessage } from './otp.ts';

const UUID_A = '3f2a8c1e-6b4d-4f9a-8e2b-1a2b3c4d5e6f';
const UUID_B = '7d1f9e0a-2c5b-4d8e-a9f0-4b5c6d7e8f90';

/** Build a broker-enveloped OTP email message (`{ data: {...} }`). */
function otpMessageBody(overrides: Record<string, unknown> = {}): Buffer {
  return Buffer.from(
    JSON.stringify({
      data: {
        messageId: UUID_A,
        recipient: 'student@example.com',
        otp: 'abc123',
        subject: 'Your OTP is here',
        expiry: 10,
        ...overrides,
      },
    }),
  );
}

describe('processOtpEmailMessage', () => {
  beforeEach(() => {
    sendMailMock.mockReset();
    isDuplicateMock.mockReset();
    forgetMessageIdMock.mockReset();
    // Default: the id was not seen before and the send succeeds.
    isDuplicateMock.mockResolvedValue(false);
    sendMailMock.mockResolvedValue({ messageId: 'test-id' });
  });

  it('sends exactly one OTP email with html and text', async () => {
    const outcome = await processOtpEmailMessage(otpMessageBody());

    expect(outcome).toEqual({ action: 'acked' });
    expect(isDuplicateMock).toHaveBeenCalledWith(UUID_A);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect(sendMailMock).toHaveBeenCalledWith(
      'student@example.com',
      'Your OTP is here',
      expect.stringContaining('abc123'),
      expect.stringContaining('abc123'),
    );
  });

  it('acks a crash-redelivered message without resending it', async () => {
    isDuplicateMock.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const body = otpMessageBody();

    expect(await processOtpEmailMessage(body, 1)).toEqual({
      action: 'acked',
    });
    expect(await processOtpEmailMessage(body, 2)).toEqual({
      action: 'acked',
    });
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });

  it('sends again for a distinct messageId', async () => {
    await processOtpEmailMessage(
      otpMessageBody({ messageId: UUID_A, otp: 'aaa111' }),
    );
    await processOtpEmailMessage(
      otpMessageBody({ messageId: UUID_B, otp: 'bbb222' }),
    );

    expect(sendMailMock).toHaveBeenCalledTimes(2);
  });

  it('drops a message with an invalid messageId', async () => {
    const outcome = await processOtpEmailMessage(
      otpMessageBody({ messageId: 'not-a-uuid' }),
    );

    expect(outcome).toEqual({ action: 'dropped' });
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('drops a malformed JSON payload', async () => {
    const outcome = await processOtpEmailMessage(Buffer.from('not json'));

    expect(outcome).toEqual({ action: 'dropped' });
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('drops a message with a code outside the OTP charset', async () => {
    const outcome = await processOtpEmailMessage(
      otpMessageBody({ otp: '!!!!!!' }),
    );

    expect(outcome).toEqual({ action: 'dropped' });
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('requests a retry with the first backoff delay on send failure', async () => {
    sendMailMock.mockRejectedValueOnce(new Error('smtp down'));

    const outcome = await processOtpEmailMessage(otpMessageBody(), 1);

    expect(outcome).toEqual({
      action: 'retry',
      delayMs: 60_000,
      nextAttempt: 2,
    });
  });

  it('steps the backoff delay per attempt', async () => {
    sendMailMock.mockRejectedValue(new Error('smtp down'));

    expect(await processOtpEmailMessage(otpMessageBody(), 2)).toEqual({
      action: 'retry',
      delayMs: 120_000,
      nextAttempt: 3,
    });
    expect(await processOtpEmailMessage(otpMessageBody(), 4)).toEqual({
      action: 'retry',
      delayMs: 480_000,
      nextAttempt: 5,
    });
  });

  it('dead-letters after the final attempt', async () => {
    sendMailMock.mockRejectedValueOnce(new Error('smtp down'));

    const outcome = await processOtpEmailMessage(otpMessageBody(), 5);

    expect(outcome).toEqual({ action: 'dead-letter' });
  });

  it('clears the dedup mark on failure so the retried copy is not skipped', async () => {
    sendMailMock
      .mockRejectedValueOnce(new Error('smtp down'))
      .mockResolvedValueOnce({ messageId: 'test-id' });
    const body = otpMessageBody();

    expect(await processOtpEmailMessage(body, 1)).toEqual({
      action: 'retry',
      delayMs: 60_000,
      nextAttempt: 2,
    });
    expect(forgetMessageIdMock).toHaveBeenCalledWith(UUID_A);
    // The retried copy (same messageId) is treated as a fresh delivery.
    expect(await processOtpEmailMessage(body, 2)).toEqual({
      action: 'acked',
    });
    expect(sendMailMock).toHaveBeenCalledTimes(2);
  });
});
