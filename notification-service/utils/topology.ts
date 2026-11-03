import type { Channel } from 'amqplib';

/**
 * Ensure that the service's RMQ topology is in its expected shape before
 * starting to consume events, so misconfigured brokers fail fast.
 *
 * Scaffold note: nothing is asserted yet. The intake queues
 * (`notification-service.<event>.v1`), the `notify_retry_*` parking lots and
 * their `foc.retry` / `foc.back` bindings are asserted here when the consumer
 * implementation lands, mirroring email-service's `utils/topology.ts`.
 */
export async function assertTopology(_ch1: Channel): Promise<void> {}
