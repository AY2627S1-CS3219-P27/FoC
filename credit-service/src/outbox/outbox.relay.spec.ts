import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/environment.js';
import type { ClaimedOutboxEvent } from './outbox-publication.types.js';
import { OutboxRelay } from './outbox.relay.js';
import type { OutboxStore } from './outbox.store.js';
import type { RabbitMqOutboxPublisher } from './rabbitmq-outbox.publisher.js';

const configuration: Pick<
  EnvironmentVariables,
  | 'OUTBOX_POLL_INTERVAL_MS'
  | 'OUTBOX_BATCH_SIZE'
  | 'OUTBOX_CLAIM_LEASE_MS'
  | 'OUTBOX_UNPUBLISHED_WARNING_MS'
> = {
  OUTBOX_POLL_INTERVAL_MS: 1_000,
  OUTBOX_BATCH_SIZE: 100,
  OUTBOX_CLAIM_LEASE_MS: 30_000,
  OUTBOX_UNPUBLISHED_WARNING_MS: 60_000,
};

function event(id: string, overrides: Partial<ClaimedOutboxEvent> = {}) {
  return {
    eventId: id,
    eventType: 'CreditAccountInitialised',
    routingKey: 'credit.account-initialised.v1',
    envelope: { eventId: id, privateValue: 'must-not-be-logged' },
    createdAt: new Date(),
    attemptCount: 1,
    lastError: null,
    ...overrides,
  } satisfies ClaimedOutboxEvent;
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function harness(events: ClaimedOutboxEvent[] = []) {
  const config = {
    getOrThrow: vi.fn((key: keyof typeof configuration) => configuration[key]),
  } as unknown as ConfigService<EnvironmentVariables, true>;
  const store = {
    claim: vi.fn().mockResolvedValue(events),
    markPublished: vi.fn().mockResolvedValue(true),
    markFailed: vi.fn().mockResolvedValue(true),
  } as unknown as OutboxStore;
  const publisher = {
    start: vi.fn().mockResolvedValue(undefined),
    publish: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as RabbitMqOutboxPublisher;

  return {
    relay: new OutboxRelay(config, store, publisher),
    store,
    publisher,
  };
}

describe('OutboxRelay', () => {
  afterEach(() => vi.restoreAllMocks());

  it('publishes a claimed batch concurrently and completes rows independently', async () => {
    const first = deferred();
    const second = deferred();
    const { relay, store, publisher } = harness([
      event('event-1'),
      event('event-2'),
    ]);
    vi.mocked(publisher.publish)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const polling = relay.runOnce();
    await vi.waitFor(() => expect(publisher.publish).toHaveBeenCalledTimes(2));
    expect(store.markPublished).not.toHaveBeenCalled();

    first.resolve();
    second.reject(new Error('payload must not appear'));
    await polling;

    expect(store.markPublished).toHaveBeenCalledTimes(1);
    expect(store.markFailed).toHaveBeenCalledWith(
      'event-2',
      expect.any(String),
      'RabbitMQ outbox publication failed (Error)',
    );
    expect(
      JSON.stringify(vi.mocked(store.markFailed).mock.calls),
    ).not.toContain('payload must not appear');
  });

  it('returns the active poll instead of overlapping claims', async () => {
    const claim = deferred<ClaimedOutboxEvent[]>();
    const { relay, store } = harness();
    vi.mocked(store.claim).mockReturnValue(claim.promise);

    const first = relay.runOnce();
    const second = relay.runOnce();

    expect(second).toBe(first);
    expect(store.claim).toHaveBeenCalledOnce();
    claim.resolve([]);
    await first;
  });

  it('retries the identical stored event on a later poll', async () => {
    const stored = event('event-retry');
    const { relay, store, publisher } = harness();
    vi.mocked(store.claim)
      .mockResolvedValueOnce([stored])
      .mockResolvedValueOnce([stored]);
    vi.mocked(publisher.publish)
      .mockRejectedValueOnce(new Error('first failure'))
      .mockResolvedValueOnce(undefined);

    await relay.runOnce();
    await relay.runOnce();

    expect(publisher.publish).toHaveBeenNthCalledWith(1, stored);
    expect(publisher.publish).toHaveBeenNthCalledWith(2, stored);
    expect(store.markFailed).toHaveBeenCalledOnce();
    expect(store.markPublished).toHaveBeenCalledOnce();
  });

  it('warns for stale rows without logging their envelopes', async () => {
    const warning = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const stale = event('event-stale', {
      createdAt: new Date(Date.now() - 61_000),
      attemptCount: 4,
      lastError: 'previous\nfailure',
    });
    const { relay } = harness([stale]);

    await relay.runOnce();

    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining('event-stale'),
    );
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('attempt=4'));
    expect(JSON.stringify(warning.mock.calls)).not.toContain('privateValue');
    expect(JSON.stringify(warning.mock.calls)).not.toContain('\n');
  });

  it('starts once and waits for an active poll before closing the publisher', async () => {
    const claim = deferred<ClaimedOutboxEvent[]>();
    const { relay, store, publisher } = harness();
    vi.mocked(store.claim).mockReturnValue(claim.promise);

    const starting = relay.start();
    await vi.waitFor(() => expect(store.claim).toHaveBeenCalled());
    const closing = relay.close();
    expect(publisher.close).not.toHaveBeenCalled();

    claim.resolve([]);
    await Promise.all([starting, closing]);
    expect(publisher.close).toHaveBeenCalledOnce();
    await expect(relay.close()).resolves.toBeUndefined();
    await expect(relay.start()).rejects.toThrow('already been started');
  });
});
