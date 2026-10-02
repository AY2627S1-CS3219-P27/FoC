import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Channel, ConsumeMessage } from 'amqplib';

vi.mock('../../utils/logger.ts', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { dispatchOutcome } from './dispatcher.ts';
import {
  ATTEMPT_HEADER,
  DELAY_HEADER,
  DLQ_EXCHANGE,
  RETRY_EXCHANGE,
} from '../../utils/topology.ts';
import { logger } from '../../utils/logger.ts';

/** Minimal channel stand-in; publish defaults to buffered (returns true). */
function fakeChannel() {
  return {
    ack: vi.fn(),
    nack: vi.fn(),
    publish: vi.fn(() => true),
  };
}

/** Minimal `ConsumeMessage` stand-in carrying content, headers and routing key. */
function fakeMessage(
  headers: Record<string, unknown> = { 'x-trace': 'abc' },
  routingKey = 'otp.email',
): ConsumeMessage {
  return {
    content: Buffer.from('payload'),
    properties: { headers },
    fields: { routingKey },
  } as unknown as ConsumeMessage;
}

describe('dispatchOutcome', () => {
  let ch: ReturnType<typeof fakeChannel>;
  let msg: ConsumeMessage;

  beforeEach(() => {
    vi.clearAllMocks();
    ch = fakeChannel();
    msg = fakeMessage();
  });

  it('acks an acked outcome', async () => {
    await dispatchOutcome(ch as unknown as Channel, msg, 1, { action: 'acked' });

    expect(ch.ack).toHaveBeenCalledWith(msg);
    expect(ch.nack).not.toHaveBeenCalled();
    expect(ch.publish).not.toHaveBeenCalled();
  });

  it('drops a dropped outcome without requeue', async () => {
    await dispatchOutcome(ch as unknown as Channel, msg, 1, { action: 'dropped' });

    expect(ch.nack).toHaveBeenCalledWith(msg, false, false);
    expect(ch.ack).not.toHaveBeenCalled();
    expect(ch.publish).not.toHaveBeenCalled();
  });

  it('republishes a retry to foc.retry with the next attempt and delay', async () => {
    await dispatchOutcome(ch as unknown as Channel, msg, 1, {
      action: 'retry',
      delayMs: 60_000,
      nextAttempt: 2,
    });

    expect(ch.publish).toHaveBeenCalledTimes(1);
    expect(ch.publish).toHaveBeenCalledWith(
      RETRY_EXCHANGE,
      'otp.email',
      msg.content,
      {
        headers: {
          'x-trace': 'abc',
          [ATTEMPT_HEADER]: 2,
          [DELAY_HEADER]: '60000',
        },
        persistent: true,
      },
    );
    expect(ch.ack).toHaveBeenCalledWith(msg);
    expect(ch.nack).not.toHaveBeenCalled();
  });

  it('preserves the attempt header when the retried copy already had one', async () => {
    const attempted = fakeMessage({ [ATTEMPT_HEADER]: 2 });
    await dispatchOutcome(ch as unknown as Channel, attempted, 2, {
      action: 'retry',
      delayMs: 120_000,
      nextAttempt: 3,
    });

    expect(ch.publish).toHaveBeenCalledWith(
      RETRY_EXCHANGE,
      'otp.email',
      attempted.content,
      expect.objectContaining({
        headers: expect.objectContaining({
          [ATTEMPT_HEADER]: 3,
          [DELAY_HEADER]: '120000',
        }),
      }),
    );
  });

  it('dead-letters after the final attempt', async () => {
    await dispatchOutcome(ch as unknown as Channel, msg, 5, { action: 'dead-letter' });

    expect(ch.publish).toHaveBeenCalledWith(
      DLQ_EXCHANGE,
      'otp.email',
      msg.content,
      { headers: { 'x-trace': 'abc' }, persistent: true },
    );
    expect(ch.ack).toHaveBeenCalledWith(msg);
    expect(ch.nack).not.toHaveBeenCalled();
  });

  it('requeues the original when the retry publish throws', async () => {
    ch.publish.mockImplementation(() => {
      throw new Error('channel closed');
    });

    await dispatchOutcome(ch as unknown as Channel, msg, 1, {
      action: 'retry',
      delayMs: 60_000,
      nextAttempt: 2,
    });

    expect(ch.nack).toHaveBeenCalledWith(msg, false, true);
    expect(ch.ack).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ attempt: 1 }),
      'Retry publish failed',
    );
  });

  it('requeues the original when the retry publish is not buffered', async () => {
    ch.publish.mockReturnValue(false);

    await dispatchOutcome(ch as unknown as Channel, msg, 2, {
      action: 'retry',
      delayMs: 120_000,
      nextAttempt: 3,
    });

    expect(ch.nack).toHaveBeenCalledWith(msg, false, true);
    expect(ch.ack).not.toHaveBeenCalled();
  });

  it('requeues the original when the dead-letter publish is not buffered', async () => {
    ch.publish.mockReturnValue(false);

    await dispatchOutcome(ch as unknown as Channel, msg, 5, { action: 'dead-letter' });

    expect(ch.nack).toHaveBeenCalledWith(msg, false, true);
    expect(ch.ack).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ attempt: 5 }),
      'Dead-letter publish failed',
    );
  });
});