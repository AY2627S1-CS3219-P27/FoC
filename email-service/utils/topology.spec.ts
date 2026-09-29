import { describe, it, expect, vi } from 'vitest';
import {
  assertTopology,
  ATTEMPT_HEADER,
  attemptOf,
  BACK_EXCHANGE,
  DELAY_HEADER,
  DLQ_EXCHANGE,
  DLQ_QUEUE,
  MAX_EMAIL_ATTEMPTS,
  OTP_EMAIL_ROUTING_KEY,
  OTP_QUEUE,
  RETRY_EXCHANGE,
  RETRY_STEPS,
} from './topology.ts';

const RETRY_QUEUE_ARGS = (delayMs: number) => ({
  durable: true,
  arguments: {
    'x-queue-type': 'classic',
    'x-dead-letter-exchange': 'foc.back',
    'x-message-ttl': delayMs,
  },
});

/** Channel stand-in that records every call for snapshotting. */
function fakeChannel() {
  return {
    assertExchange: vi.fn().mockResolvedValue(undefined),
    assertQueue: vi.fn().mockResolvedValue(undefined),
    bindQueue: vi.fn().mockResolvedValue(undefined),
  };
}

describe('assertTopology', () => {
  it('asserts the retry/DLQ/back exchanges', async () => {
    const ch = fakeChannel();
    await assertTopology(ch);

    expect(ch.assertExchange.mock.calls).toEqual([
      ['foc.retry', 'headers', { durable: true }],
      ['foc.dlq', 'direct', { durable: true }],
      ['foc.back', 'direct', { durable: true }],
    ]);
  });

  it('asserts the email queues, per-hop retry queues and DLQs in order', async () => {
    const ch = fakeChannel();
    await assertTopology(ch);

    expect(ch.assertQueue.mock.calls).toEqual([
      [
        'otp_emails',
        { durable: true, arguments: { 'x-queue-type': 'classic' } },
      ],
      ['email_retry_60s', RETRY_QUEUE_ARGS(60_000)],
      ['email_retry_120s', RETRY_QUEUE_ARGS(120_000)],
      ['email_retry_240s', RETRY_QUEUE_ARGS(240_000)],
      ['email_retry_480s', RETRY_QUEUE_ARGS(480_000)],
      [
        'otp_emails.dlq',
        { durable: true, arguments: { 'x-queue-type': 'classic' } },
      ],
    ]);
  });

  it('binds each hop to foc.retry by delay header, and the delivery queues to foc.back/DLQ by routing key', async () => {
    const ch = fakeChannel();
    await assertTopology(ch);

    expect(ch.bindQueue.mock.calls).toEqual([
      [
        'email_retry_60s',
        'foc.retry',
        '',
        { 'x-match': 'all', 'foc-delay': '60000' },
      ],
      [
        'email_retry_120s',
        'foc.retry',
        '',
        { 'x-match': 'all', 'foc-delay': '120000' },
      ],
      [
        'email_retry_240s',
        'foc.retry',
        '',
        { 'x-match': 'all', 'foc-delay': '240000' },
      ],
      [
        'email_retry_480s',
        'foc.retry',
        '',
        { 'x-match': 'all', 'foc-delay': '480000' },
      ],
      ['otp_emails.dlq', 'foc.dlq', 'otp.email'],
      ['otp_emails', 'foc.back', 'otp.email'],
    ]);
  });
});

describe('topology constants', () => {
  it('pins the resource names asserted at startup and seeded in definitions.json', () => {
    expect(RETRY_EXCHANGE).toBe('foc.retry');
    expect(DLQ_EXCHANGE).toBe('foc.dlq');
    expect(BACK_EXCHANGE).toBe('foc.back');
    expect(ATTEMPT_HEADER).toBe('x-foc-attempt');
    expect(DELAY_HEADER).toBe('foc-delay');
    expect(OTP_QUEUE).toBe('otp_emails');
    expect(DLQ_QUEUE).toBe('otp_emails.dlq');
    expect(OTP_EMAIL_ROUTING_KEY).toBe('otp.email');
  });

  it('derives one parking-lot queue per backoff hop and MAX from the steps', () => {
    expect(RETRY_STEPS).toEqual([
      { queue: 'email_retry_60s', delayMs: 60_000 },
      { queue: 'email_retry_120s', delayMs: 120_000 },
      { queue: 'email_retry_240s', delayMs: 240_000 },
      { queue: 'email_retry_480s', delayMs: 480_000 },
    ]);
    // One delivery per step plus the final attempt that dead-letters.
    expect(MAX_EMAIL_ATTEMPTS).toBe(RETRY_STEPS.length + 1);
    expect(MAX_EMAIL_ATTEMPTS).toBe(5);
  });
});

describe('attemptOf', () => {
  it.each([
    [undefined, 1],
    [0, 1],
    [-3, 1],
    ['abc', 1],
    [2, 2],
    ['3', 3],
    ['99', 5],
  ])('maps %s to %s', (raw, expected) => {
    expect(attemptOf(raw)).toBe(expected);
  });
});
