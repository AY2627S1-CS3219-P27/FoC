import { AsyncLocalStorage } from 'node:async_hooks';

/** Who is acting, for the audit log (F14.4). */
export interface AuditContext {
  /** The token's `sub`, lower-cased; null when the system acts (the seed). */
  actorId: string | null;
}

/**
 * Carries the acting user from the request to the services without adding a
 * parameter to every write method. Set by AuditContextInterceptor, after the
 * login guard, from the verified token only, never from the request body.
 */
export const auditContext = new AsyncLocalStorage<AuditContext>();

/** The acting user's id, or null outside a request (the seed, a script). */
export function currentActor(): string | null {
  return auditContext.getStore()?.actorId ?? null;
}

/** Runs `work` as the given actor (also used by tests). */
export function withActor<T>(actorId: string | null, work: () => T): T {
  return auditContext.run({ actorId }, work);
}
