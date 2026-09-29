// Outcome of email process.
// Retry has additional delay/attempt data.
export type ProcessOutcome =
  | { readonly action: 'acked' }
  | { readonly action: 'dropped' }
  | {
      readonly action: 'retry';
      readonly delayMs: number;
      readonly nextAttempt: number;
    }
  | { readonly action: 'dead-letter' };

export type EmailProcessor = (
  body: Buffer,
  attempt?: number,
) => Promise<ProcessOutcome>;

export type Listener = {
  queueKey: string;
  handler: EmailProcessor;
};
