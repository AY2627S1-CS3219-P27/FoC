import { auditContext, currentActor, withActor } from './audit-context.js';

describe('the audit context (F14.4)', () => {
  it('has no actor outside a request, which means the system', () => {
    expect(currentActor()).toBeNull();
  });

  it('gives the actor set for a call, through awaits and timers', async () => {
    const seen = await withActor('u1', async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 1));
      return currentActor();
    });

    expect(seen).toBe('u1');
    expect(currentActor()).toBeNull();
  });

  it('keeps two concurrent calls apart', async () => {
    const slow = withActor('slow', async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return currentActor();
    });
    const fast = withActor('fast', async () => currentActor());

    await expect(Promise.all([slow, fast])).resolves.toEqual(['slow', 'fast']);
  });

  it('lets an explicit null actor stand for the system inside a request', () => {
    expect(withActor(null, () => currentActor())).toBeNull();
    expect(auditContext.getStore()).toBeUndefined();
  });
});
