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

import { processPasswordResetEmailMessage } from './password-reset.ts';

const UUID_A = '3f2a8c1e-6b4d-4f9a-8e2b-1a2b3c4d5e6f';
const UUID_B = '7d1f9e0a-2c5b-4d8e-a9f0-4b5c6d7e8f90';

/** Build a broker-enveloped password reset email message (`{ data: {...} }`). */
function passwordResetMessageBody(
  overrides: Record<string, unknown> = {},
): Buffer {
  return Buffer.from(
    JSON.stringify({
      data: {
        messageId: UUID_A,
        recipient: 'student@example.com',
        resetLink: 'https://foc.example/reset-password?token=abc',
        subject: 'Reset your password',
        expiry: 10,
        ...overrides,
      },
    }),
  );
}

describe('processPasswordResetEmailMessage', () => {
  beforeEach(() => {
    sendMailMock.mockReset();
    isDuplicateMock.mockReset();
    forgetMessageIdMock.mockReset();
    // Default: the id was not seen before and the send succeeds.
    isDuplicateMock.mockResolvedValue(false);
    sendMailMock.mockResolvedValue({ messageId: 'test-id' });
  });

  it('sends exactly one password reset email with the link in html and text', async () => {
    const outcome = await processPasswordResetEmailMessage(
      passwordResetMessageBody(),
    );

    expect(outcome).toEqual({ action: 'acked' });
    expect(isDuplicateMock).toHaveBeenCalledWith(UUID_A);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect(sendMailMock).toHaveBeenCalledWith(
      'student@example.com',
      'Reset your password',
      expect.stringContaining('https://foc.example/reset-password?token=abc'),
      expect.stringContaining('https://foc.example/reset-password?token=abc'),
    );
  });

  it('sends again for a distinct messageId', async () => {
    await processPasswordResetEmailMessage(
      passwordResetMessageBody({
        messageId: UUID_A,
        resetLink: 'https://a.example/r?t=1',
      }),
    );
    await processPasswordResetEmailMessage(
      passwordResetMessageBody({
        messageId: UUID_B,
        resetLink: 'https://b.example/r?t=2',
      }),
    );

    expect(sendMailMock).toHaveBeenCalledTimes(2);
  });

  it('drops a message with a non-url resetLink', async () => {
    const outcome = await processPasswordResetEmailMessage(
      passwordResetMessageBody({ resetLink: 'not-a-url' }),
    );

    expect(outcome).toEqual({ action: 'dropped' });
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('drops a message with an invalid messageId', async () => {
    const outcome = await processPasswordResetEmailMessage(
      passwordResetMessageBody({ messageId: 'not-a-uuid' }),
    );

    expect(outcome).toEqual({ action: 'dropped' });
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('drops a malformed JSON payload', async () => {
    const outcome = await processPasswordResetEmailMessage(
      Buffer.from('not json'),
    );

    expect(outcome).toEqual({ action: 'dropped' });
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('requests a retry with the first backoff delay on send failure', async () => {
    sendMailMock.mockRejectedValueOnce(new Error('smtp down'));

    const outcome = await processPasswordResetEmailMessage(
      passwordResetMessageBody(),
      1,
    );

    expect(outcome).toEqual({
      action: 'retry',
      delayMs: 60_000,
      nextAttempt: 2,
    });
  });

  it('dead-letters after the final attempt', async () => {
    sendMailMock.mockRejectedValueOnce(new Error('smtp down'));

    const outcome = await processPasswordResetEmailMessage(
      passwordResetMessageBody(),
      5,
    );

    expect(outcome).toEqual({ action: 'dead-letter' });
  });
});
