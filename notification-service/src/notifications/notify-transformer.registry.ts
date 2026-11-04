import { Inject, Injectable } from '@nestjs/common';
import type { NotificationContent } from '../database/entities/notification.entity.js';

/** Canonical internal shape the notification pipeline understands. */
export interface TranslatedNotification {
  notificationGuid: string;
  userId: string;
  content: NotificationContent;
}

/**
 * Coerces one upstream notification-generating event into the canonical
 * shape. Implementations validate the raw payload against that event's
 * `@foc/contracts` schema and must return null for anything they do not
 * recognise (poison), never a partial translation.
 */
export interface NotifyEventTransformer {
  translate(body: unknown): TranslatedNotification | null;
}

/** Injection token for the routing-key → transformer map. */
export const NOTIFY_TRANSFORMERS = Symbol('NOTIFY_TRANSFORMERS');

export type NotifyTransformerMap = ReadonlyMap<string, NotifyEventTransformer>;

/**
 * The coercion seam for tapping other services' events.
 *
 * The initial notify event can be in any upstream shape; a transformer maps
 * each producing event's routing key onto `TranslatedNotification`, so the
 * pipeline (rows, attempt guards, retries) only ever sees the canonical shape.
 * The map ships empty: adding a future event is one new binding plus one
 * transformer, with no change to the pipeline.
 */
@Injectable()
export class NotifyTransformerRegistry {
  constructor(
    @Inject(NOTIFY_TRANSFORMERS)
    private readonly transformers: NotifyTransformerMap,
  ) {}

  translate(routingKey: string, body: unknown): TranslatedNotification | null {
    const transformer = this.transformers.get(routingKey);
    return transformer ? transformer.translate(body) : null;
  }
}
