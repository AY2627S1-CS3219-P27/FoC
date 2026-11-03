/**
 * A queue consumer registration. Handlers are pure functions of the message
 * body — all broker mechanics (acking, retry republish, dead-lettering) stay
 * in `app.ts` / the future dispatcher, keeping handlers portable (see the
 * notification design doc's transport/logic seam).
 *
 * The handler signature widens to carry the delivery-attempt count and return
 * a ProcessOutcome when the RetryNotify dispatch machinery lands.
 */
export type NotificationProcessor = (body: Buffer) => Promise<void>;

export type Listener = {
  queueKey: string;
  handler: NotificationProcessor;
};
