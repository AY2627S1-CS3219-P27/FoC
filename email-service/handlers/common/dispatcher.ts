import type { Channel, ConsumeMessage } from 'amqplib';
import type { ProcessOutcome } from '../types.ts';
import {
  ATTEMPT_HEADER,
  DELAY_HEADER,
  DLQ_EXCHANGE,
  RETRY_EXCHANGE,
} from '../../utils/topology.ts';
import { logger } from '../../utils/logger.ts';

// Dispatches a handler outcome onto the channel. Each republish preserves the
// message's routing key, so foc.back can route the retried copy back to its
// originating queue.
export const dispatchOutcome = async (
  ch: Channel,
  msg: ConsumeMessage,
  attempt: number,
  outcome: ProcessOutcome,
) => {
  switch (outcome.action) {
    case 'acked':
      ch.ack(msg);
      break;
    case 'dropped':
      // Poison message: drop without requeue rather than redeliver forever.
      ch.nack(msg, false, false);
      break;
    case 'retry': {
      // Re-enter the retry loop with the next attempt number and this hop's
      // delay in the foc-delay header. foc.retry (headers exchange) routes
      // the copy into the matching parking-lot queue, whose x-message-ttl
      // expiries it and dead-letters it back to foc.back; foc.back routes it
      // to the originating queue by the preserved routing key for the next
      // attempt.
      try {
        const published = ch.publish(
          RETRY_EXCHANGE,
          msg.fields.routingKey,
          msg.content,
          {
            headers: {
              ...msg.properties.headers,
              [ATTEMPT_HEADER]: outcome.nextAttempt,
              [DELAY_HEADER]: String(outcome.delayMs),
            },
            persistent: true,
          },
        );
        if (!published) {
          throw new Error('retry publish not buffered');
        }
        ch.ack(msg);
      } catch (err) {
        // Publish threw or returned false (unbuffered): requeue the original
        // (headers preserved) so it is not lost; the attempt counter
        // survives the requeue.
        logger.error({ err, attempt }, 'Retry publish failed');
        ch.nack(msg, false, true);
      }
      break;
    }
    case 'dead-letter': {
      try {
        const published = ch.publish(
          DLQ_EXCHANGE,
          msg.fields.routingKey,
          msg.content,
          {
            headers: msg.properties.headers,
            persistent: true,
          },
        );
        if (!published) {
          throw new Error('dead-letter publish not buffered');
        }
        ch.ack(msg);
      } catch (err) {
        logger.error({ err, attempt }, 'Dead-letter publish failed');
        ch.nack(msg, false, true);
      }
      break;
    }
  }
};
