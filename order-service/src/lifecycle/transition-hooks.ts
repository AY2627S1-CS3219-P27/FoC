import type { TransitionInput, TransitionResult } from './transition.js';

// Post-commit observers of transition(). Additive and best-effort: a listener
// runs only after the transaction has committed, cannot change the result, and
// its failure (sync or async) is swallowed. Listeners must do their own logging.
// First user: tracking cleanup on Picked Up -> Delivered / Cancelled.
export interface CommittedTransition {
  errandId: string;
  expected: TransitionInput['expected'];
  to: TransitionInput['to'];
  type?: string;
}

type Listener = (t: CommittedTransition) => void | Promise<void>;
const listeners = new Set<Listener>();

export function onTransitionCommitted(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Called by transition() with its input and result. Replays (nothing was
// written this time) and refusals notify nobody.
export function notifyCommitted(i: TransitionInput, result: TransitionResult): void {
  if (!result.ok || result.replayed) return;
  const t: CommittedTransition = { errandId: i.errandId, expected: i.expected, to: i.to, type: i.type };
  for (const l of listeners) {
    try {
      void Promise.resolve(l(t)).catch(() => undefined);
    } catch {
      // swallowed by design
    }
  }
}
