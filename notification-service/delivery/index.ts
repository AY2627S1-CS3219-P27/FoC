/**
 * Delivery outcome for one notification against one push subscription. Maps
 * onto the notification states: `submitted` → Submitted, `retry` → transient
 * failure (republish RetryNotify with a delay), `failed` → permanent failure
 * (e.g. the push service answered 410 Gone: subscription is gone for good).
 */
export type DeliveryOutcome =
  | { readonly kind: 'submitted' }
  | { readonly kind: 'retry' }
  | { readonly kind: 'failed' };

/**
 * Deliver one notification to one push subscription via the Web Push
 * protocol: a VAPID-signed, payload-encrypted HTTPS POST to the
 * subscription's endpoint URL.
 *
 * Scaffold stub: the `web-push` dependency, VAPID key handling and the
 * status-code → outcome mapping (2xx / 429+5xx+timeout / 404+410) land with
 * the implementation phase.
 */
export async function deliverNotification(
  _subscription: unknown,
  _notification: unknown,
): Promise<DeliveryOutcome> {
  throw new Error(
    'Not implemented: web-push delivery lands with the implementation phase',
  );
}
