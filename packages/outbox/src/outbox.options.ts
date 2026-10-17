export const OUTBOX_OPTIONS = Symbol('OUTBOX_OPTIONS');

/** Broker destination and publisher identity resolved per consuming service. */
export interface OutboxOptions {
  exchange: string;
  appId: string;
  rabbitMqUrl: string;
}
