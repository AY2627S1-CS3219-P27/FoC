import { OutboxRelayLifecycle } from './outbox-relay.lifecycle.js';
import type { OutboxRelay } from './outbox.relay.js';

describe('OutboxRelayLifecycle', () => {
  it('starts and closes the relay with the application lifecycle', async () => {
    const relay = {
      start: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as OutboxRelay;
    const lifecycle = new OutboxRelayLifecycle(relay);

    await lifecycle.onApplicationBootstrap();
    await lifecycle.onApplicationShutdown();

    expect(relay.start).toHaveBeenCalledOnce();
    expect(relay.close).toHaveBeenCalledOnce();
  });
});
