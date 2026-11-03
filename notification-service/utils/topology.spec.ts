import { describe, expect, it } from 'vitest';
import type { Channel } from 'amqplib';
import { assertTopology } from './topology.ts';

describe('assertTopology', () => {
  it('is a no-op until the intake/retry topology lands', async () => {
    await expect(assertTopology({} as Channel)).resolves.toBeUndefined();
  });
});
