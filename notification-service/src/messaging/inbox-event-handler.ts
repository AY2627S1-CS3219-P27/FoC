import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Logger } from '@nestjs/common';
import {
  type AccountEventContractValidator,
  type AnyDomainEvent,
  type DomainEventDispatcher,
  type DomainEventHandlers,
} from '@foc/contracts';
import type { Channel, ConfirmChannel, ConsumeMessage, Options } from 'amqplib';
import type { DispatchService } from '../dispatch/dispatch.service.js';
import type { InboxService } from '../inbox/inbox.service.js';
import {
  NOTIFICATION_DEAD_LETTER_EXCHANGE,
  NOTIFICATION_DEAD_LETTER_QUEUE,
  NOTIFICATION_RETRY_EXCHANGE,
  ORIGINAL_ROUTING_KEY_HEADER,
  RETRY_COUNT_HEADER,
  RETRY_DELAY_HEADER,
} from './notification-topology.js';

const MAX_FAILURE_REASON_LENGTH = 512;
const REQUEUE_DELAY_MS = 1_000;

type FailureCategory =
  | 'MALFORMED_JSON'
  | 'INVALID_RETRY_METADATA'
  | 'EVENT_ID_CONFLICT'
  | 'INVALID_EVENT'
  | 'PROCESSING_RETRIES_EXHAUSTED';

interface Failure {
  category: FailureCategory;
  reason: string;
}

interface ContractFailure {
  code: string;
  violations: ReadonlyArray<{ instancePath: string; message: string }>;
}

/** A message that passed parsing and retry-metadata checks. */
type PreparedDelivery =
  | {
      ok: true;
      body: unknown;
      routingKey: string;
      retryCount: number;
    }
  | { ok: false; failure: Failure };

export interface InboxEventHandlerDeps {
  contracts: AccountEventContractValidator;
  dispatcher: DomainEventDispatcher;
  inbox: InboxService;
  dispatch: DispatchService;
  handlers: DomainEventHandlers;
  retryDelays: readonly number[];
  logger: Logger;
}

/** Handles one delivery on the current connection's channels. */
export type InboxMessageHandler = (
  message: ConsumeMessage,
  consumerChannel: Channel,
  publisherChannel: ConfirmChannel,
) => Promise<void>;

/**
 * Builds the per-delivery decision tree: validate the received contract,
 * record it in the transactional inbox, run its dispatchers, then deliver what
 * is pending. Transient failures throw so the transport can retry; permanent
 * failures are dead-lettered.
 *
 * Channels are per-connection and therefore arrive with each message rather
 * than being captured here.
 */
export function createInboxEventHandler(
  deps: InboxEventHandlerDeps,
): InboxMessageHandler {
  return (message, consumerChannel, publisherChannel) =>
    handleInboxEvent(deps, message, consumerChannel, publisherChannel);
}

async function handleInboxEvent(
  deps: InboxEventHandlerDeps,
  message: ConsumeMessage,
  consumerChannel: Channel,
  publisherChannel: ConfirmChannel,
): Promise<void> {
  const prepared = prepareDelivery(deps, message);
  if (!prepared.ok) {
    return deadLetter(
      deps,
      message,
      consumerChannel,
      publisherChannel,
      prepared.failure,
    );
  }

  return recordAndDispatch(
    deps,
    message,
    consumerChannel,
    publisherChannel,
    prepared,
  );
}

/** JSON parse + retry metadata. Pure apart from logging. */
function prepareDelivery(
  deps: InboxEventHandlerDeps,
  message: ConsumeMessage,
): PreparedDelivery {
  let body: unknown;
  try {
    body = JSON.parse(message.content.toString('utf8')) as unknown;
  } catch {
    return invalid('MALFORMED_JSON', 'message body is not valid JSON');
  }

  const headers = message.properties.headers ?? {};
  const retryCount = retryCountFrom(
    deps.retryDelays,
    headers[RETRY_COUNT_HEADER],
  );
  if (retryCount === null) {
    return invalid(
      'INVALID_RETRY_METADATA',
      'x-retry-count must be 0 through the retry-delay count',
    );
  }

  const routingKey =
    retryCount === 0
      ? message.fields.routingKey
      : headers[ORIGINAL_ROUTING_KEY_HEADER];
  if (typeof routingKey !== 'string' || routingKey.length === 0) {
    return invalid(
      'INVALID_RETRY_METADATA',
      'retry is missing its original routing key',
    );
  }

  return { ok: true, body, routingKey, retryCount };
}

async function recordAndDispatch(
  deps: InboxEventHandlerDeps,
  message: ConsumeMessage,
  consumerChannel: Channel,
  publisherChannel: ConfirmChannel,
  prepared: Extract<PreparedDelivery, { ok: true }>,
): Promise<void> {
  const checked = deps.contracts.validateReceived(
    prepared.routingKey,
    prepared.body,
  );
  if (!checked.valid) {
    return handleInvalidContract(
      deps,
      message,
      consumerChannel,
      publisherChannel,
      prepared,
      checked,
    );
  }

  try {
    return await ingestAndDeliver(
      deps,
      message,
      consumerChannel,
      publisherChannel,
      prepared,
      checked.value,
    );
  } catch (error) {
    return handleProcessingFailure(
      deps,
      message,
      consumerChannel,
      publisherChannel,
      prepared,
      checked.value.eventId,
      error,
    );
  }
}

async function handleInvalidContract(
  deps: InboxEventHandlerDeps,
  message: ConsumeMessage,
  consumerChannel: Channel,
  publisherChannel: ConfirmChannel,
  prepared: Extract<PreparedDelivery, { ok: true }>,
  failure: ContractFailure,
): Promise<void> {
  if (failure.code === 'UNSUPPORTED_EVENT_TYPE') {
    // Broad `#` subscriptions must not dead-letter contracts they do not
    // implement.
    deps.logger.debug(`Skipped unregistered event ${prepared.routingKey}`);
    ack(message, consumerChannel);
    return;
  }

  return deadLetter(deps, message, consumerChannel, publisherChannel, {
    category: 'INVALID_EVENT',
    reason: `${failure.code}: ${failure.violations
      .map((violation) => `${violation.instancePath} ${violation.message}`)
      .join('; ')}`,
  });
}

async function ingestAndDeliver(
  deps: InboxEventHandlerDeps,
  message: ConsumeMessage,
  consumerChannel: Channel,
  publisherChannel: ConfirmChannel,
  prepared: Extract<PreparedDelivery, { ok: true }>,
  event: AnyDomainEvent,
): Promise<void> {
  const outcome = await deps.inbox.ingest(prepared.routingKey, event);
  if (outcome === 'conflict') {
    return deadLetter(deps, message, consumerChannel, publisherChannel, {
      category: 'EVENT_ID_CONFLICT',
      reason: 'event id was reused with different evidence',
    });
  }

  // Dispatchers decide what to enqueue; the runner then sends whatever is
  // still pending. A redelivery re-runs both, but enqueue is idempotent and
  // sent deliveries are skipped.
  const dispatched = await deps.dispatcher.dispatch(
    prepared.routingKey,
    event,
    deps.handlers,
  );
  if (dispatched.outcome === 'invalid') {
    return deadLetter(deps, message, consumerChannel, publisherChannel, {
      category: 'INVALID_EVENT',
      reason: `${dispatched.code}: revalidation failed before dispatch`,
    });
  }

  await deps.dispatch.deliverPending(event.eventId);
  ack(message, consumerChannel);
}

function handleProcessingFailure(
  deps: InboxEventHandlerDeps,
  message: ConsumeMessage,
  consumerChannel: Channel,
  publisherChannel: ConfirmChannel,
  prepared: Extract<PreparedDelivery, { ok: true }>,
  eventId: string,
  error: unknown,
): Promise<void> {
  deps.logger.warn(
    `Notification processing failed for event ${eventId} on attempt ${prepared.retryCount + 1}: ${
      error instanceof Error ? error.message : 'unknown error'
    }`,
  );

  if (prepared.retryCount < deps.retryDelays.length) {
    return retryDelivery(
      deps,
      message,
      consumerChannel,
      publisherChannel,
      prepared,
    );
  }

  return deadLetter(deps, message, consumerChannel, publisherChannel, {
    category: 'PROCESSING_RETRIES_EXHAUSTED',
    reason: `processing failed after ${deps.retryDelays.length} retries`,
  });
}

async function retryDelivery(
  deps: InboxEventHandlerDeps,
  message: ConsumeMessage,
  consumerChannel: Channel,
  publisherChannel: ConfirmChannel,
  prepared: Extract<PreparedDelivery, { ok: true }>,
): Promise<void> {
  const delay = deps.retryDelays[prepared.retryCount];
  const headers = {
    ...stripTransportHeaders(message.properties.headers ?? {}),
    [RETRY_COUNT_HEADER]: prepared.retryCount + 1,
    [ORIGINAL_ROUTING_KEY_HEADER]: prepared.routingKey,
    [RETRY_DELAY_HEADER]: String(delay),
  };

  try {
    // Empty routing key: the shared headers exchange selects the delay queue.
    await publishConfirmed(
      publisherChannel,
      NOTIFICATION_RETRY_EXCHANGE,
      '',
      message.content,
      { persistent: true, contentType: 'application/json', headers },
    );
  } catch (error) {
    deps.logger.error(`Unable to confirm retry publication: ${String(error)}`);
    return requeue(message, consumerChannel);
  }

  // Remove the original only after the broker accepted its replacement.
  ack(message, consumerChannel);
}

async function deadLetter(
  deps: InboxEventHandlerDeps,
  message: ConsumeMessage,
  consumerChannel: Channel,
  publisherChannel: ConfirmChannel,
  failure: Failure,
): Promise<void> {
  const headers = {
    ...stripTransportHeaders(message.properties.headers ?? {}),
    'x-failure-category': failure.category,
    'x-failure-reason': failure.reason
      .replace(/[\r\n\t]+/g, ' ')
      .trim()
      .slice(0, MAX_FAILURE_REASON_LENGTH),
    'x-failure-timestamp': new Date().toISOString(),
  };

  try {
    await publishConfirmed(
      publisherChannel,
      NOTIFICATION_DEAD_LETTER_EXCHANGE,
      NOTIFICATION_DEAD_LETTER_QUEUE,
      message.content,
      { persistent: true, contentType: 'application/json', headers },
    );
  } catch (error) {
    deps.logger.error(
      `Unable to confirm dead-letter publication: ${String(error)}`,
    );
    return requeue(message, consumerChannel);
  }

  ack(message, consumerChannel);
  deps.logger.warn(
    `Dead-lettered notification event: ${failure.category} (${failure.reason})`,
  );
}

async function publishConfirmed(
  channel: ConfirmChannel,
  exchange: string,
  routingKey: string,
  content: Buffer,
  options: Options.Publish,
): Promise<void> {
  let resolveConfirmation!: () => void;
  let rejectConfirmation!: (error: unknown) => void;
  const confirmation = new Promise<void>((resolve, reject) => {
    resolveConfirmation = resolve;
    rejectConfirmation = reject;
  });

  const publishId = randomUUID();
  const onReturn = (returned: ConsumeMessage | null) => {
    if (returned?.properties.headers?.['x-publish-id'] === publishId) {
      rejectConfirmation(
        new Error(`Unroutable publish to ${exchange} with key ${routingKey}`),
      );
    }
  };
  channel.on('return', onReturn);

  let writable: boolean;
  try {
    writable = channel.publish(
      exchange,
      routingKey,
      content,
      {
        ...options,
        mandatory: true,
        headers: { ...options.headers, 'x-publish-id': publishId },
      },
      (error) => {
        if (error) {
          rejectConfirmation(error);
        } else {
          resolveConfirmation();
        }
      },
    );
  } catch (error) {
    rejectConfirmation(error);
    writable = true;
  }

  const drained = writable ? Promise.resolve() : once(channel, 'drain');
  try {
    await Promise.all([confirmation, drained]);
  } finally {
    channel.off('return', onReturn);
  }
}

function retryCountFrom(
  retryDelays: readonly number[],
  value: unknown,
): number | null {
  if (value === undefined) {
    return 0;
  }
  return Number.isInteger(value) &&
    (value as number) >= 0 &&
    (value as number) <= retryDelays.length
    ? (value as number)
    : null;
}

function ack(message: ConsumeMessage, channel: Channel): void {
  try {
    channel.ack(message);
  } catch {
    // A closed channel returns unacknowledged deliveries automatically.
  }
}

async function requeue(
  message: ConsumeMessage,
  channel: Channel,
): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, REQUEUE_DELAY_MS));
  try {
    channel.nack(message, false, true);
  } catch {
    // A closed channel returns unacknowledged deliveries automatically.
  }
}

function stripTransportHeaders(
  headers: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(headers).filter(
      ([name]) =>
        name !== RETRY_COUNT_HEADER &&
        name !== RETRY_DELAY_HEADER &&
        name !== ORIGINAL_ROUTING_KEY_HEADER &&
        name !== 'x-publish-id' &&
        !name.startsWith('x-failure-'),
    ),
  );
}

function invalid(
  category: FailureCategory,
  reason: string,
): Extract<PreparedDelivery, { ok: false }> {
  return { ok: false, failure: { category, reason } };
}
