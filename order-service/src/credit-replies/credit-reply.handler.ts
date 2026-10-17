import {
  AccountEventContractValidator,
  type ContractViolation,
  type EventContractKey,
  type EventOf,
} from '@foc/contracts';
import { Logger } from '@nestjs/common';
import type { LifecycleService } from '../lifecycle/lifecycle.service.js';
import { SYSTEM, type TransitionInput } from '../lifecycle/transition.js';
import type {
  IncomingDomainMessage,
  MessageHandlingResult,
  RabbitMqMessageHandler,
} from '../messaging/rabbitmq-message.types.js';

type Step = Omit<TransitionInput, 'actor' | 'idempotencyKey'>;
// What a valid reply asks for: a transition, a log line only, or a refusal.
type Plan = Step | { log: string } | { deadLetter: string };

export interface ReplySpec {
  key: EventContractKey;
  queue: string; // seeded in rabbitmq/definitions.json
  plan(event: EventOf<never>): Plan;
  // On a STATE_MISMATCH against a Cancelled errand, send the release again.
  releaseIfCancelled?: true;
}

// Typed per key; the payload and event id feed the event's private payload.
const reply = <K extends EventContractKey>(
  key: K,
  plan: (e: EventOf<K>) => Plan,
  releaseIfCancelled?: true,
): ReplySpec => ({
  key,
  queue: `order-service.${key.replace('.', '-')}`,
  plan: plan as ReplySpec['plan'],
  releaseIfCancelled,
});

// The seven credit replies. The event's payload keeps credit's reason and
// event id and never a projection column name (ADR 0005).
export const REPLY_SPECS: ReplySpec[] = [
  reply(
    'credit.reservation-success.v1',
    (e) => ({
      errandId: e.payload.errandId,
      expected: 'Reserving-Credit',
      to: 'Open',
      payload: {
        creditEventId: e.eventId,
        creditTransactionId: e.payload.creditTransactionId,
        reservedAmount: e.payload.reservedAmount,
      },
    }),
    true,
  ),
  reply('credit.reservation-rejected.v1', (e) => {
    const reason = e.payload.rejectionReason;
    // RESERVATION_CONFLICT is not a cancellation reason: credit may hold a
    // reservation, so a person decides. The (planned) credit timeout sweep then cancels and releases.
    if (reason === 'RESERVATION_CONFLICT') {
      return { deadLetter: 'RESERVATION_CONFLICT needs manual handling' };
    }
    return {
      errandId: e.payload.errandId,
      expected: 'Reserving-Credit',
      to: 'Cancelled',
      set: { cancellationReason: reason },
      payload: {
        creditEventId: e.eventId,
        requestedAmount: e.payload.requestedAmount,
      },
    };
  }),
  reply('credit.reservation-adjustment-success.v1', (e) => ({
    errandId: e.payload.errandId,
    expected: 'Adjusting-Credit',
    to: 'Open',
    type: 'CreditAdjusted',
    set: { rewardCredits: e.payload.newReservedAmount },
    payload: {
      creditEventId: e.eventId,
      creditTransactionId: e.payload.creditTransactionId,
    },
  })),
  reply('credit.reservation-adjustment-rejected.v1', (e) => ({
    errandId: e.payload.errandId,
    expected: 'Adjusting-Credit',
    to: 'Open',
    type: 'CreditAdjustmentFailed',
    payload: {
      creditEventId: e.eventId,
      reason: e.payload.rejectionReason,
      requestedAmount: e.payload.requestedAmount,
    },
  })),
  reply('credit.transfer-succeeded.v1', (e) => ({
    errandId: e.payload.errandId,
    expected: 'Transferring-Credit',
    to: 'Completed',
    payload: {
      creditEventId: e.eventId,
      creditTransactionId: e.payload.creditTransactionId,
      transferredAmount: e.payload.transferredAmount,
    },
  })),
  // Back to Delivered (ADR 0006); the auto-complete sweep is meant to skip it from then on.
  reply('credit.transfer-rejected.v1', (e) => ({
    errandId: e.payload.errandId,
    expected: 'Transferring-Credit',
    to: 'Delivered',
    payload: { creditEventId: e.eventId, reason: e.payload.rejectionReason },
  })),
  // Release is fire-and-forget (ADR 0006): nothing to revert, only an alert.
  reply('credit.release-rejected.v1', (e) => ({
    log: `credit rejected the release of errand ${e.payload.errandId}: ${e.payload.rejectionReason}`,
  })),
];

const describeViolations = (code: string, violations: ContractViolation[]) =>
  `${code}: ${
    violations
      .map((v) => `${v.instancePath || '/'} ${v.keyword}: ${v.message}`)
      .join('; ') || 'contract validation failed'
  }`;

/**
 * Validate against the contract, then make the reply one SYSTEM transition
 * keyed by the envelope's eventId (the idempotency table is the inbox). Ack
 * only after that has committed; a thrown error is retried by the broker.
 */
export class CreditReplyHandler implements RabbitMqMessageHandler {
  private readonly logger = new Logger(CreditReplyHandler.name);

  constructor(
    private readonly spec: ReplySpec,
    private readonly lifecycle: Pick<
      LifecycleService,
      'transition' | 'releaseCredit'
    >,
    private readonly contracts: AccountEventContractValidator,
  ) {}

  async handle(message: IncomingDomainMessage): Promise<MessageHandlingResult> {
    const checked = this.contracts.validate(this.spec.key, message.body);
    if (!checked.valid) {
      return {
        outcome: 'dead-letter',
        eventId: message.eventId,
        category: checked.code,
        reason: describeViolations(checked.code, checked.violations),
      };
    }
    const event = checked.value;
    const plan = this.spec.plan(event as EventOf<never>);

    if ('log' in plan) {
      this.logger.error(plan.log);
      return { outcome: 'ack' };
    }
    if ('deadLetter' in plan) {
      return {
        outcome: 'dead-letter',
        eventId: event.eventId,
        category: 'INVALID_PAYLOAD',
        reason: plan.deadLetter,
      };
    }

    const result = await this.lifecycle.transition({
      ...plan,
      actor: SYSTEM,
      idempotencyKey: event.eventId,
    });
    if (result.ok) return { outcome: 'ack' };

    switch (result.reason) {
      case 'STATE_MISMATCH':
        // A stale or duplicate reply. The one that matters: credit reserved
        // for an errand we already cancelled.
        if (this.spec.releaseIfCancelled && result.currentStatus === 'Cancelled') {
          await this.lifecycle.releaseCredit(plan.errandId, event.eventId);
        }
        this.logger.warn(
          `${this.spec.key} ${event.eventId}: errand ${plan.errandId} is ${result.currentStatus}, expected ${plan.expected}`,
        );
        return { outcome: 'ack' };
      case 'NOT_FOUND':
        this.logger.warn(
          `${this.spec.key} ${event.eventId}: unknown errand ${plan.errandId}`,
        );
        return { outcome: 'ack' };
      case 'IDEMPOTENCY_KEY_REUSED':
        return {
          outcome: 'dead-letter',
          eventId: event.eventId,
          category: 'INVALID_ENVELOPE',
          reason: 'event ID was previously processed with different content',
        };
      default:
        // Our mapping is wrong (ILLEGAL_TRANSITION, INVALID_FIELDS, ...): a
        // bug, not a bad message. Throw so it retries, then dead-letters.
        throw new Error(
          `${this.spec.key} ${event.eventId}: transition refused: ${result.reason}`,
        );
    }
  }
}
