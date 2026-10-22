import { describe, it, expect, vi, afterEach } from 'vitest';
import { trace, type Span } from '@opentelemetry/api';
import {
  annotateConsumeSpan,
  MESSAGE_RETRY_COUNT_ATTRIBUTE,
} from '../src/messaging.js';

function stubSpan(): { span: Span; setAttribute: ReturnType<typeof vi.fn> } {
  const setAttribute = vi.fn();
  return {
    span: { setAttribute } as unknown as Span,
    setAttribute,
  };
}

describe('annotateConsumeSpan', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sets the event id, routing key and retry count on the active span', () => {
    const { span, setAttribute } = stubSpan();
    vi.spyOn(trace, 'getActiveSpan').mockReturnValue(span);

    annotateConsumeSpan({
      messageId: 'evt-1',
      routingKey: 'user.registered.v1',
      retryCount: 2,
    });

    expect(setAttribute).toHaveBeenCalledWith('messaging.message.id', 'evt-1');
    expect(setAttribute).toHaveBeenCalledWith(
      'messaging.rabbitmq.destination.routing_key',
      'user.registered.v1',
    );
    expect(setAttribute).toHaveBeenCalledWith(
      MESSAGE_RETRY_COUNT_ATTRIBUTE,
      2,
    );
    expect(setAttribute).toHaveBeenCalledTimes(3);
  });

  it('skips attributes whose value is unknown', () => {
    const { span, setAttribute } = stubSpan();
    vi.spyOn(trace, 'getActiveSpan').mockReturnValue(span);

    annotateConsumeSpan({ routingKey: 'user.registered.v1' });

    expect(setAttribute).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when no span is active', () => {
    vi.spyOn(trace, 'getActiveSpan').mockReturnValue(undefined);

    expect(() => annotateConsumeSpan({ messageId: 'evt-1' })).not.toThrow();
  });
});
